import { FastifyInstance } from "fastify";
import {
  generateAgentReply,
  type AgentProviderConfig,
  type AgentProviderRegistry
} from "@hawkcode/agent";
import {
  agentProviderInfoSchema,
  agentCommitReplyRequestSchema,
  agentReplyRequestSchema,
  agentReplyResponseSchema,
  type AgentChatMessage,
  type AgentCommandEvent,
  type AgentToolCall,
  type AgentProviderInfo
} from "@hawkcode/shared";
import { prisma } from "../lib/prisma.js";
import { loadRuntimeConfig } from "../lib/runtime-config.js";
import { getSessionUser } from "../lib/auth-session.js";

const SESSION_NOTE_PREFIX = "[Session note]";

function normalizeOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatProviderLabel(provider: string) {
  return provider === "codex"
    ? "Codex"
    : provider === "cursor"
      ? "Cursor CLI"
      : provider === "gemini"
        ? "Gemini CLI"
      : provider === "openrouter"
        ? "OpenRouter"
        : "Agent";
}

function formatRunLabel(provider: string, model: string) {
  return `${formatProviderLabel(provider)} · ${model}`;
}

function buildSessionNote(provider: string, model: string) {
  return `${SESSION_NOTE_PREFIX} Model changed to ${formatRunLabel(provider, model)}.`;
}

function buildCommandEventNote(event: AgentCommandEvent) {
  return `[[hawkcode_command_event]]${JSON.stringify(event)}`;
}

function parseToolCallInput(raw?: string | null) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as {
      provider?: string;
      model?: string;
    };
  } catch {
    return null;
  }
}

async function buildProviderRegistry(): Promise<AgentProviderRegistry> {
  const runtimeConfig = loadRuntimeConfig();
  const openrouterApiKey = runtimeConfig?.openrouterApiKey;
  const openrouter = openrouterApiKey
    ? {
        apiKey: openrouterApiKey,
        baseUrl: runtimeConfig?.openrouterBaseUrl,
        defaultModel: runtimeConfig?.openrouterModel ?? "openai/gpt-5",
        siteUrl: runtimeConfig?.openrouterSiteUrl,
        appName: runtimeConfig?.openrouterAppName ?? "HawkCode"
      }
    : undefined;

  return {
    ...(openrouter ? { openrouter } : {})
  };
}

function getAvailableProviders(registry: AgentProviderRegistry): AgentProviderInfo[] {
  const providers: AgentProviderInfo[] = [];

  if (registry.openrouter) {
    providers.push({
      name: "openrouter",
      label: "OpenRouter",
      defaultModel: registry.openrouter.defaultModel
    });
  }

  return providers.map((provider) => agentProviderInfoSchema.parse(provider));
}

function getMembershipWorkspaceIds(
  memberships: Array<{ workspaceId: string }>
) {
  return new Set(memberships.map((membership) => membership.workspaceId));
}

function trimTitle(source: string) {
  const singleLine = source.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 80) || "New session";
}

async function resolveSession(options: {
  sessionId?: string;
  userId: string;
  workspaceIds: Set<string>;
  fallbackWorkspaceId: string;
  initialMessage: string;
}) {
  if (options.sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: options.sessionId }
    });

    if (!session || !options.workspaceIds.has(session.workspaceId)) {
      throw new Error("session_not_found");
    }

    return session;
  }

  const created = await prisma.session.create({
    data: {
      title: trimTitle(options.initialMessage),
      ownerId: options.userId,
      workspaceId: options.fallbackWorkspaceId
    }
  });
  return created;
}

async function getConversationMessages(sessionId: string, systemPrompt?: string) {
  const dbMessages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 24
  });

  const messages: AgentChatMessage[] = [];
  if (systemPrompt) {
    messages.push({
      role: "system",
      content: systemPrompt
    });
  }

  for (const message of dbMessages) {
    if (message.role === "system" && message.content.startsWith(SESSION_NOTE_PREFIX)) {
      continue;
    }

    if (message.role === "user" || message.role === "assistant" || message.role === "system") {
      messages.push({
        role: message.role,
        content: message.content
      });
    }
  }

  return messages;
}

async function createToolCall(options: {
  agentRunId: string;
  name?: string;
  input: string;
  output?: string;
  durationMs?: number;
}) {
  await prisma.toolCall.create({
    data: {
      agentRunId: options.agentRunId,
      name: options.name ?? "generate_reply",
      input: options.input,
      output: options.output,
      durationMs: options.durationMs
    }
  });
}

async function persistAgentReply(options: {
  provider: "codex" | "cursor" | "gemini" | "openrouter";
  model: string;
  sessionId?: string;
  message: string;
  assistantContent: string;
  toolCalls?: AgentToolCall[];
  commandEvents?: AgentCommandEvent[];
  systemPrompt?: string;
  userId: string;
  memberships: Array<{ workspaceId: string }>;
}) {
  const primaryMembership = options.memberships[0];
  if (!primaryMembership) {
    throw new Error("no_workspace");
  }

  const workspaceIds = getMembershipWorkspaceIds(options.memberships);
  const session = await resolveSession({
    sessionId: options.sessionId,
    userId: options.userId,
    workspaceIds,
    fallbackWorkspaceId: primaryMembership.workspaceId,
    initialMessage: options.message
  });

  const latestRun = await prisma.agentRun.findFirst({
    where: {
      sessionId: session.id
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      toolCalls: {
        where: {
          name: "generate_reply"
        },
        orderBy: {
          id: "desc"
        },
        take: 1
      }
    }
  });
  const previousRun = parseToolCallInput(latestRun?.toolCalls[0]?.input);
  const providerChanged =
    previousRun?.provider && previousRun.model
      ? previousRun.provider !== options.provider || previousRun.model !== options.model
      : false;
  if (providerChanged) {
    await prisma.message.create({
      data: {
        sessionId: session.id,
        authorId: options.userId,
        role: "system",
        content: buildSessionNote(options.provider, options.model)
      }
    });
  }

  const userMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      authorId: options.userId,
      role: "user",
      content: options.message
    }
  });

  const agentRun = await prisma.agentRun.create({
    data: {
      sessionId: session.id,
      status: "running"
    }
  });

  for (const commandEvent of options.commandEvents ?? []) {
    await prisma.message.create({
      data: {
        sessionId: session.id,
        authorId: options.userId,
        role: "system",
        content: buildCommandEventNote(commandEvent)
      }
    });
  }

  const assistantMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      authorId: options.userId,
      role: "assistant",
      content: options.assistantContent
    }
  });

  await prisma.agentRun.update({
    where: { id: agentRun.id },
    data: { status: "succeeded" }
  });

  await createToolCall({
    agentRunId: agentRun.id,
    input: JSON.stringify({
      provider: options.provider,
      model: options.model,
      sessionId: session.id,
      prompt: userMessage.content,
      systemPrompt: options.systemPrompt
    }),
    output: options.assistantContent
  });

  for (const toolCall of options.toolCalls ?? []) {
    await createToolCall({
      agentRunId: agentRun.id,
      name: toolCall.name,
      input:
        toolCall.input ??
        JSON.stringify({
          provider: options.provider,
          model: options.model
        }),
      output: toolCall.output,
      durationMs: toolCall.durationMs
    });
  }

  return agentReplyResponseSchema.parse({
    sessionId: session.id,
    agentRunId: agentRun.id,
    provider: options.provider,
    model: options.model,
    message: {
      id: assistantMessage.id,
      role: "assistant",
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt.toISOString()
    }
  });
}

export async function registerAgentRoutes(server: FastifyInstance) {
  server.get("/agent/providers", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const registry = await buildProviderRegistry();
    return reply.send({
      providers: getAvailableProviders(registry)
    });
  });

  server.post("/agent/reply", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = agentReplyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    const registry = await buildProviderRegistry();
    const configuredProvider = registry[parsed.data.provider] as AgentProviderConfig | undefined;
    if (!configuredProvider) {
      return reply.code(400).send({
        error: "provider_not_configured"
      });
    }

    const primaryMembership = user.memberships[0];
    if (!primaryMembership) {
      return reply.code(403).send({ error: "no_workspace" });
    }

    try {
      const workspaceIds = getMembershipWorkspaceIds(user.memberships);
      const session = await resolveSession({
        sessionId: parsed.data.sessionId,
        userId: user.id,
        workspaceIds,
        fallbackWorkspaceId: primaryMembership.workspaceId,
        initialMessage: parsed.data.message
      });
      const inputMessages = await getConversationMessages(session.id, parsed.data.systemPrompt);
      inputMessages.push({
        role: "user",
        content: parsed.data.message
      });
      const startedAt = Date.now();
      const result = await generateAgentReply({
        provider: parsed.data.provider,
        model: parsed.data.model,
        messages: inputMessages,
        registry
      });
      const durationMs = Date.now() - startedAt;
      const persisted = await persistAgentReply({
        provider: result.provider,
        model: result.model,
        sessionId: session.id,
        message: parsed.data.message,
        assistantContent: result.content,
        toolCalls: result.toolCalls,
        systemPrompt: parsed.data.systemPrompt,
        userId: user.id,
        memberships: user.memberships
      });

      await prisma.toolCall.updateMany({
        where: {
          agentRunId: persisted.agentRunId,
          name: "generate_reply"
        },
        data: {
          durationMs
        }
      });

      return reply.send(persisted);
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }

      request.log.error(error);
      return reply.code(502).send({
        error: "agent_request_failed",
        message: error instanceof Error ? error.message : "unknown_error"
      });
    }
  });

  server.post("/agent/reply/commit", async (request, reply) => {
    const user = await getSessionUser(request.cookies.hawkcode_session);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = agentCommitReplyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await persistAgentReply({
        provider: parsed.data.provider,
        model: parsed.data.model ?? "gpt-5",
        sessionId: parsed.data.sessionId,
        message: parsed.data.message,
        assistantContent: parsed.data.assistantContent,
        toolCalls: parsed.data.toolCalls,
        commandEvents: parsed.data.commandEvents,
        systemPrompt: parsed.data.systemPrompt,
        userId: user.id,
        memberships: user.memberships
      });

      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      if (error instanceof Error && error.message === "no_workspace") {
        return reply.code(403).send({ error: "no_workspace" });
      }

      request.log.error(error);
      return reply.code(500).send({
        error: "agent_commit_failed"
      });
    }
  });
}

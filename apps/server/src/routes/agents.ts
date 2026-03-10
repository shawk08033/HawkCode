import { FastifyInstance } from "fastify";
import {
  canUseCodex,
  generateAgentReply,
  type AgentProviderConfig,
  type AgentProviderRegistry
} from "@hawkcode/agent";
import {
  agentProviderInfoSchema,
  agentReplyRequestSchema,
  agentReplyResponseSchema,
  type AgentChatMessage,
  type AgentProviderInfo
} from "@hawkcode/shared";
import { prisma } from "../lib/prisma.js";
import { loadRuntimeConfig } from "../lib/runtime-config.js";
import { getSessionUser } from "../lib/auth-session.js";

async function buildProviderRegistry(): Promise<AgentProviderRegistry> {
  const runtimeConfig = loadRuntimeConfig();
  const getValue = (configValue: string | undefined, envName: string) =>
    configValue ?? process.env[envName];

  const codexCommand = getValue(runtimeConfig?.codexPath, "CODEX_PATH") ?? "codex";
  const codex = await canUseCodex(codexCommand)
    ? {
        command: codexCommand,
        defaultModel: getValue(runtimeConfig?.codexModel, "CODEX_MODEL") ?? "gpt-5"
      }
    : undefined;

  const openrouterApiKey = getValue(runtimeConfig?.openrouterApiKey, "OPENROUTER_API_KEY");
  const openrouter = openrouterApiKey
    ? {
        apiKey: openrouterApiKey,
        baseUrl: getValue(runtimeConfig?.openrouterBaseUrl, "OPENROUTER_BASE_URL"),
        defaultModel:
          getValue(runtimeConfig?.openrouterModel, "OPENROUTER_MODEL") ?? "openai/gpt-5",
        siteUrl: getValue(runtimeConfig?.openrouterSiteUrl, "OPENROUTER_SITE_URL"),
        appName: getValue(runtimeConfig?.openrouterAppName, "OPENROUTER_APP_NAME") ?? "HawkCode"
      }
    : undefined;

  return {
    ...(codex ? { codex } : {}),
    ...(openrouter ? { openrouter } : {})
  };
}

function getAvailableProviders(registry: AgentProviderRegistry): AgentProviderInfo[] {
  const providers: AgentProviderInfo[] = [];

  if (registry.codex) {
    providers.push({
      name: "codex",
      label: "Codex",
      defaultModel: registry.codex.defaultModel
    });
  }

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
  input: string;
  output?: string;
  durationMs?: number;
}) {
  await prisma.toolCall.create({
    data: {
      agentRunId: options.agentRunId,
      name: "generate_reply",
      input: options.input,
      output: options.output,
      durationMs: options.durationMs
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

      const userMessage = await prisma.message.create({
        data: {
          sessionId: session.id,
          authorId: user.id,
          role: "user",
          content: parsed.data.message
        }
      });

      const agentRun = await prisma.agentRun.create({
        data: {
          sessionId: session.id,
          status: "running"
        }
      });

      const inputMessages = await getConversationMessages(session.id, parsed.data.systemPrompt);
      const startedAt = Date.now();
      const result = await generateAgentReply({
        provider: parsed.data.provider,
        model: parsed.data.model,
        messages: inputMessages,
        registry
      });
      const durationMs = Date.now() - startedAt;

      const assistantMessage = await prisma.message.create({
        data: {
          sessionId: session.id,
          authorId: user.id,
          role: "assistant",
          content: result.content
        }
      });

      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: { status: "succeeded" }
      });

      await createToolCall({
        agentRunId: agentRun.id,
        input: JSON.stringify({
          provider: parsed.data.provider,
          model: parsed.data.model ?? configuredProvider.defaultModel,
          sessionId: session.id,
          prompt: userMessage.content
        }),
        output: result.content,
        durationMs
      });

      return reply.send(
        agentReplyResponseSchema.parse({
          sessionId: session.id,
          agentRunId: agentRun.id,
          provider: result.provider,
          model: result.model,
          message: {
            id: assistantMessage.id,
            role: "assistant",
            content: assistantMessage.content,
            createdAt: assistantMessage.createdAt.toISOString()
          }
        })
      );
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
}

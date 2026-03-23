import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentChatMessage, AgentProvider, AgentToolCall } from "@hawkcode/shared";

const execFileAsync = promisify(execFile);

export type AgentProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  appName?: string;
  siteUrl?: string;
  command?: string;
};

export type AgentProviderRegistry = Partial<Record<AgentProvider, AgentProviderConfig>>;

export type GenerateAgentReplyOptions = {
  provider: AgentProvider;
  model?: string;
  messages: AgentChatMessage[];
  registry: AgentProviderRegistry;
};

export type GenerateAgentReplyResult = {
  provider: AgentProvider;
  model: string;
  content: string;
  toolCalls?: AgentToolCall[];
};

type OpenRouterPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type CursorPayload = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
};

type JsonRecord = Record<string, unknown>;

function requireProviderConfig(
  provider: AgentProvider,
  registry: AgentProviderRegistry
): AgentProviderConfig {
  const config = registry[provider];
  if (!config) {
    throw new Error(`Provider ${provider} is not configured.`);
  }
  if (provider === "openrouter" && !config.apiKey) {
    throw new Error(`Provider ${provider} is not configured.`);
  }
  return config;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function buildCliPrompt(providerLabel: string, messages: AgentChatMessage[]) {
  return [
    `You are the ${providerLabel} agent inside HawkCode.`,
    "Respond to the latest user request using the conversation below as context.",
    "Return only the assistant reply text.",
    "",
    ...messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
  ].join("\n");
}

function extractOpenRouterText(payload: OpenRouterPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text.trim() : ""))
      .filter((part) => part.length > 0)
      .join("\n\n")
      .trim();
  }

  return "";
}

function extractCursorText(payload: CursorPayload) {
  if (payload.type !== "result" || payload.subtype !== "success" || payload.is_error) {
    return "";
  }

  return typeof payload.result === "string" ? payload.result.trim() : "";
}

function stringifyJson(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function parseJsonLines(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRecord];
      } catch {
        return [];
      }
    });
}

function isToolLikeEventType(value: unknown) {
  return typeof value === "string" && /(tool|mcp|call)/i.test(value);
}

function normalizeToolCall(name: string, input?: unknown, output?: unknown, durationMs?: unknown) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }

  const parsedDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.round(durationMs)
      : undefined;

  return {
    name: normalizedName,
    input: stringifyJson(input),
    output: stringifyJson(output),
    durationMs: parsedDuration
  } satisfies AgentToolCall;
}

function extractCodexToolCalls(events: JsonRecord[]) {
  const toolCalls: AgentToolCall[] = [];

  for (const event of events) {
    if (event.type !== "item.completed") {
      continue;
    }

    const item = event.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const itemRecord = item as JsonRecord;
    const itemType = itemRecord.type;
    if (!isToolLikeEventType(itemType) && typeof itemRecord.name !== "string") {
      continue;
    }

    if (itemType === "agent_message") {
      continue;
    }

    const normalized = normalizeToolCall(
      typeof itemRecord.name === "string" ? itemRecord.name : String(itemType ?? "tool_call"),
      itemRecord.input ?? itemRecord.arguments ?? itemRecord.payload,
      itemRecord.output ?? itemRecord.result ?? itemRecord.content,
      itemRecord.duration_ms ?? itemRecord.durationMs
    );
    if (normalized) {
      toolCalls.push(normalized);
    }
  }

  return toolCalls;
}

function extractCursorToolCalls(events: JsonRecord[]) {
  const toolCalls: AgentToolCall[] = [];

  for (const event of events) {
    const eventType = event.type;
    const eventName =
      typeof event.tool_name === "string"
        ? event.tool_name
        : typeof event.name === "string" && isToolLikeEventType(eventType)
          ? event.name
          : undefined;

    if (!eventName && !isToolLikeEventType(eventType)) {
      continue;
    }

    if (eventType === "result") {
      continue;
    }

    const normalized = normalizeToolCall(
      eventName ?? String(eventType ?? "tool_call"),
      event.input ?? event.arguments ?? event.params ?? event.request,
      event.output ?? event.result ?? event.response,
      event.duration_ms ?? event.durationMs
    );
    if (normalized) {
      toolCalls.push(normalized);
    }
  }

  return toolCalls;
}

async function generateCodexReply(
  config: AgentProviderConfig,
  messages: AgentChatMessage[],
  model?: string
) {
  const prompt = buildCliPrompt("Codex", messages);
  let stdout = "";

  try {
    const result = await execFileAsync(config.command ?? "codex", [
      "exec",
      "--skip-git-repo-check",
      "--full-auto",
      "--json",
      "-m",
      model ?? config.defaultModel,
      prompt
    ], {
      cwd: process.cwd(),
      env: process.env
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    throw new Error(`Codex CLI request failed: ${message}`);
  }

  const events = parseJsonLines(stdout);
  const content = events
    .flatMap((event) => {
      const item = event.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }

      const itemRecord = item as JsonRecord;
      return itemRecord.type === "agent_message" && typeof itemRecord.text === "string"
        ? [itemRecord.text.trim()]
        : [];
    })
    .filter((value) => value.length > 0)
    .at(-1) ?? "";
  if (!content) {
    throw new Error("Codex returned an empty response.");
  }

  return {
    provider: "codex" as const,
    model: model ?? config.defaultModel,
    content,
    toolCalls: extractCodexToolCalls(events)
  };
}

async function generateCursorReply(
  config: AgentProviderConfig,
  messages: AgentChatMessage[],
  model?: string
) {
  const prompt = buildCliPrompt("Cursor", messages);

  let stdout: string;
  try {
    const result = await execFileAsync(config.command ?? "cursor-agent", [
      "--print",
      "--output-format",
      "stream-json",
      "--approve-mcps",
      "-m",
      model ?? config.defaultModel,
      prompt
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(config.apiKey ? { CURSOR_API_KEY: config.apiKey } : {})
      }
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    throw new Error(`Cursor CLI request failed: ${message}`);
  }

  const events = parseJsonLines(stdout);
  const payload = events.at(-1) as CursorPayload | undefined;
  if (!payload) {
    throw new Error("Cursor CLI returned invalid JSON.");
  }

  const content = extractCursorText(payload);
  if (!content) {
    throw new Error("Cursor CLI returned an empty response.");
  }

  return {
    provider: "cursor" as const,
    model: model ?? config.defaultModel,
    content,
    toolCalls: extractCursorToolCalls(events)
  };
}

async function generateOpenRouterReply(
  config: AgentProviderConfig,
  messages: AgentChatMessage[],
  model?: string
) {
  const response = await fetch(
    `${normalizeBaseUrl(config.baseUrl ?? "https://openrouter.ai/api/v1")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        ...(config.siteUrl ? { "http-referer": config.siteUrl } : {}),
        ...(config.appName ? { "x-title": config.appName } : {})
      },
      body: JSON.stringify({
        model: model ?? config.defaultModel,
        messages
      })
    }
  );

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as OpenRouterPayload;
  const content = extractOpenRouterText(payload);
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    provider: "openrouter" as const,
    model: model ?? config.defaultModel,
    content
  };
}

export async function canUseCodex(command = "codex") {
  try {
    await execFileAsync(command, ["login", "status"], {
      cwd: process.cwd(),
      env: process.env
    });
    return true;
  } catch {
    return false;
  }
}

export async function canUseCursor(command = "cursor-agent", apiKey?: string) {
  try {
    await execFileAsync(command, apiKey ? ["--version"] : ["status"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(apiKey ? { CURSOR_API_KEY: apiKey } : {})
      }
    });
    return true;
  } catch {
    return false;
  }
}

export async function generateAgentReply(
  options: GenerateAgentReplyOptions
): Promise<GenerateAgentReplyResult> {
  const config = requireProviderConfig(options.provider, options.registry);

  if (options.provider === "codex") {
    return generateCodexReply(config, options.messages, options.model);
  }

  if (options.provider === "cursor") {
    return generateCursorReply(config, options.messages, options.model);
  }

  return generateOpenRouterReply(config, options.messages, options.model);
}

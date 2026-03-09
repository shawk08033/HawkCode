import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentChatMessage, AgentProvider } from "@hawkcode/shared";

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
};

type OpenRouterPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function requireProviderConfig(
  provider: AgentProvider,
  registry: AgentProviderRegistry
): AgentProviderConfig {
  const config = registry[provider];
  if (!config) {
    throw new Error(`Provider ${provider} is not configured.`);
  }
  if (provider !== "codex" && !config.apiKey) {
    throw new Error(`Provider ${provider} is not configured.`);
  }
  return config;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
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

async function generateCodexReply(
  config: AgentProviderConfig,
  messages: AgentChatMessage[],
  model?: string
) {
  const outputFile = path.join(
    await fs.mkdtemp(path.join(tmpdir(), "hawkcode-codex-")),
    "last-message.txt"
  );
  const prompt = [
    "You are the Codex agent inside HawkCode.",
    "Respond to the latest user request using the conversation below as context.",
    "Return only the assistant reply text.",
    "",
    ...messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
  ].join("\n");

  try {
    await execFileAsync(config.command ?? "codex", [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputFile,
      "-m",
      model ?? config.defaultModel,
      prompt
    ], {
      cwd: process.cwd(),
      env: process.env
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    throw new Error(`Codex CLI request failed: ${message}`);
  }

  const content = (await fs.readFile(outputFile, "utf8")).trim();
  if (!content) {
    throw new Error("Codex returned an empty response.");
  }

  return {
    provider: "codex" as const,
    model: model ?? config.defaultModel,
    content
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

export async function generateAgentReply(
  options: GenerateAgentReplyOptions
): Promise<GenerateAgentReplyResult> {
  const config = requireProviderConfig(options.provider, options.registry);

  if (options.provider === "codex") {
    return generateCodexReply(config, options.messages, options.model);
  }

  return generateOpenRouterReply(config, options.messages, options.model);
}

import { app, BrowserWindow, ipcMain, net, session, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const Store = require("electron-store") as typeof import("electron-store");

const isDev = !app.isPackaged;
const allowSelfSigned = isDev;
const execFileAsync = promisify(execFile);

if (allowSelfSigned) {
  app.commandLine.appendSwitch("ignore-certificate-errors");
  app.commandLine.appendSwitch("allow-insecure-localhost", "true");
}

type StoreShape = {
  serverUrl?: string;
  trustedCerts?: Record<string, string>;
  cursorChats?: Record<string, string>;
  geminiSessions?: Record<string, string>;
};

type PendingCert = {
  fingerprint: string;
  issuerName?: string;
  validStart?: number;
  validExpiry?: number;
};

type AgentToolCall = {
  name: string;
  input?: string;
  output?: string;
  durationMs?: number;
};

type JsonRecord = Record<string, unknown>;

type LocalAgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type LocalAgentCommandStatus = "running" | "completed" | "failed";

type LocalAgentCommandRecord = {
  id: string;
  command: string;
  status: LocalAgentCommandStatus;
  output: string;
  exitCode?: number | null;
};

type LocalAgentRunRecord = {
  id: string;
  provider: "codex" | "cursor" | "gemini";
  sessionId?: string;
  model: string;
  status: LocalAgentRunStatus;
  startedAt: string;
  finishedAt?: string;
  prompt: string;
  content?: string;
  error?: string;
  stdout: string;
  stderr: string;
  toolCalls?: AgentToolCall[];
  commandEvents?: LocalAgentCommandRecord[];
};

type LocalAgentRunState = LocalAgentRunRecord & {
  child?: ChildProcess;
};

const store = new Store<StoreShape>({
  defaults: {
    trustedCerts: {},
    cursorChats: {},
    geminiSessions: {}
  }
});

const devServerUrl = isDev ? process.env.HAWKCODE_SERVER_URL?.trim() : undefined;
if (devServerUrl) {
  store.set("serverUrl", devServerUrl.replace(/\/$/, ""));
}

const pendingCerts = new Map<string, PendingCert>();
const codexCommand = "codex";
const geminiCommand = "gemini";
const defaultGeminiModel = process.env.HAWKCODE_GEMINI_MODEL?.trim() || "auto";
const defaultCursorModel = process.env.HAWKCODE_CURSOR_MODEL?.trim() || "auto";
let codexAuthState: {
  loggedIn: boolean;
  inProgress: boolean;
  authUrl?: string;
  code?: string;
  statusText?: string;
  error?: string;
} = {
  loggedIn: false,
  inProgress: false
};
let geminiCliState: {
  found: boolean;
  loggedIn: boolean;
  command: string | null;
  email?: string;
  statusText: string;
  error?: string;
} = {
  found: false,
  loggedIn: false,
  command: null,
  statusText: "Gemini CLI not found"
};
let cursorCliState: {
  found: boolean;
  loggedIn: boolean;
  inProgress: boolean;
  command: string | null;
  authUrl?: string;
  statusText: string;
  error?: string;
} = {
  found: false,
  loggedIn: false,
  inProgress: false,
  command: null,
  statusText: "Cursor CLI not found"
};
const localAgentRuns = new Map<string, LocalAgentRunState>();
const maxStoredLocalAgentRuns = 20;

function extractFirstUrl(value: string) {
  return value.match(/https?:\/\/\S+/)?.[0];
}

function extractDeviceCode(value: string) {
  return value.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
}

function stripAnsi(value: string) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function createLocalAgentRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function trimLog(value: string) {
  const maxLength = 24000;
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

function toIsoNow() {
  return new Date().toISOString();
}

function serializeLocalAgentRun(run: LocalAgentRunState): LocalAgentRunRecord {
  return {
    id: run.id,
    provider: run.provider,
    sessionId: run.sessionId,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    prompt: run.prompt,
    content: run.content,
    error: run.error,
    stdout: run.stdout,
    stderr: run.stderr,
    toolCalls: run.toolCalls,
    commandEvents: run.commandEvents
  };
}

function rememberLocalAgentRun(run: LocalAgentRunState) {
  localAgentRuns.delete(run.id);
  localAgentRuns.set(run.id, run);
  while (localAgentRuns.size > maxStoredLocalAgentRuns) {
    const oldestKey = localAgentRuns.keys().next().value;
    if (!oldestKey) {
      break;
    }
    localAgentRuns.delete(oldestKey);
  }
}

function updateLocalAgentRun(
  runId: string,
  updater: (current: LocalAgentRunState) => void
) {
  const run = localAgentRuns.get(runId);
  if (!run) {
    return;
  }

  updater(run);
  rememberLocalAgentRun(run);
}

function getResolvedGeminiCommand() {
  const explicit = process.env.HAWKCODE_GEMINI_PATH?.trim();
  const candidates = [
    explicit,
    geminiCommand,
    "/usr/bin/gemini",
    "/usr/local/bin/gemini",
    "/opt/homebrew/bin/gemini"
  ].filter((value): value is string => Boolean(value && value.length > 0));

  for (const candidate of candidates) {
    if (!candidate.includes("/")) {
      try {
        const result = execFileSync("bash", ["-lc", `command -v ${candidate}`], {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"]
        }).trim();
        if (result) {
          return result;
        }
      } catch {
        continue;
      }
    }

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getResolvedCursorCommand() {
  const explicit = process.env.HAWKCODE_CURSOR_PATH?.trim();
  const homeCandidates = [
    process.env.HOME?.trim(),
    homedir(),
    (() => {
      try {
        return userInfo().homedir;
      } catch {
        return undefined;
      }
    })(),
    process.env.USER?.trim() ? path.join("/home", process.env.USER.trim()) : undefined
  ].filter((value, index, all): value is string => Boolean(value && all.indexOf(value) === index));
  const candidates = [
    explicit,
    "agent",
    "cursor-agent",
    ...homeCandidates.flatMap((homeDir) => [
      path.join(homeDir, ".local/bin/agent"),
      path.join(homeDir, ".cursor/bin/agent"),
      path.join(homeDir, ".local/bin/cursor-agent"),
      path.join(homeDir, ".cursor/bin/cursor-agent")
    ])
  ].filter((value): value is string => Boolean(value && value.length > 0));

  for (const candidate of candidates) {
    if (!candidate.includes("/")) {
      try {
        const result = execFileSync("bash", ["-lc", `command -v ${candidate}`], {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"]
        }).trim();
        if (result) {
          return result;
        }
      } catch {
        continue;
      }
    }

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getCursorEnv(command: string) {
  const commandDir = path.dirname(command);
  const currentPath = process.env.PATH ?? "";
  const nextPath = currentPath.split(":").includes(commandDir)
    ? currentPath
    : `${commandDir}:${currentPath}`;
  return {
    ...process.env,
    PATH: nextPath
  };
}

function getStoredCursorChats() {
  return store.get("cursorChats") ?? {};
}

function getStoredGeminiSessions() {
  return store.get("geminiSessions") ?? {};
}

function getCursorChatId(sessionId?: string) {
  if (!sessionId) {
    return null;
  }

  const chats = getStoredCursorChats();
  return chats[sessionId] ?? null;
}

function setCursorChatId(sessionId: string, chatId: string) {
  const chats = getStoredCursorChats();
  store.set("cursorChats", {
    ...chats,
    [sessionId]: chatId
  });
}

function clearCursorChatId(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  const chats = { ...getStoredCursorChats() };
  delete chats[sessionId];
  store.set("cursorChats", chats);
}

function getGeminiResumeSessionId(sessionId?: string) {
  if (!sessionId) {
    return null;
  }

  const sessions = getStoredGeminiSessions();
  return sessions[sessionId] ?? null;
}

function setGeminiResumeSessionId(sessionId: string, resumeSessionId: string) {
  const sessions = getStoredGeminiSessions();
  store.set("geminiSessions", {
    ...sessions,
    [sessionId]: resumeSessionId
  });
}

function clearGeminiResumeSessionId(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  const sessions = { ...getStoredGeminiSessions() };
  delete sessions[sessionId];
  store.set("geminiSessions", sessions);
}

function getGeminiEnv() {
  const env = {
    ...process.env,
    GEMINI_DEFAULT_AUTH_TYPE: "oauth-personal"
  } as NodeJS.ProcessEnv;

  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_GENAI_USE_VERTEXAI;

  return env;
}

function buildCliPrompt(providerLabel: string, messages: Array<{ role: string; content: string }>) {
  return [
    `You are the ${providerLabel} agent inside HawkCode.`,
    "Respond to the latest user request using the conversation below as context.",
    "Return only the assistant reply text.",
    "",
    ...messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
  ].join("\n");
}

function summarizeForCursor(content: string) {
  const flattened = content
    .replace(/```[\s\S]*?```/g, "[code block omitted]")
    .replace(/\s+/g, " ")
    .trim();

  if (flattened.length <= 600) {
    return flattened;
  }

  return `${flattened.slice(0, 597)}...`;
}

function buildCursorPrompt(messages: Array<{ role: string; content: string }>) {
  const recentMessages = messages.slice(-6);
  const latestUserMessage = [...recentMessages].reverse().find((message) => message.role === "user");
  const contextMessages = recentMessages.slice(0, latestUserMessage ? -1 : recentMessages.length);

  return [
    "You are the Cursor agent inside HawkCode.",
    "Answer the latest user request.",
    "Return only the assistant reply text.",
    "",
    "Recent conversation context:",
    ...contextMessages.map((message) => `${message.role}: ${summarizeForCursor(message.content)}`),
    "",
    "Latest user request:",
    summarizeForCursor(latestUserMessage?.content ?? messages[messages.length - 1]?.content ?? "")
  ].join("\n");
}

function buildGeminiPrompt(messages: Array<{ role: string; content: string }>) {
  const recentMessages = messages.slice(-8);
  const latestUserMessage = [...recentMessages].reverse().find((message) => message.role === "user");
  const contextMessages = recentMessages.slice(0, latestUserMessage ? -1 : recentMessages.length);

  return [
    "You are the Gemini agent inside HawkCode.",
    "Answer the latest user request.",
    "Return only the assistant reply text.",
    "",
    "Recent conversation context:",
    ...contextMessages.map((message) => `${message.role}: ${summarizeForCursor(message.content)}`),
    "",
    "Latest user request:",
    summarizeForCursor(latestUserMessage?.content ?? messages[messages.length - 1]?.content ?? "")
  ].join("\n");
}

function extractJsonObject(value: string) {
  const text = stripAnsi(value).trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(text.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
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

function parseJsonLines(value: string) {
  return value
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

  const normalizedDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.round(durationMs)
      : undefined;

  return {
    name: normalizedName,
    input: stringifyJson(input),
    output: stringifyJson(output),
    durationMs: normalizedDuration
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
    if (itemType === "agent_message") {
      continue;
    }

    if (!isToolLikeEventType(itemType) && typeof itemRecord.name !== "string") {
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
    if (event.type === "result") {
      continue;
    }

    const eventName =
      typeof event.tool_name === "string"
        ? event.tool_name
        : typeof event.name === "string" && isToolLikeEventType(event.type)
          ? event.name
          : undefined;

    if (!eventName && !isToolLikeEventType(event.type)) {
      continue;
    }

    const normalized = normalizeToolCall(
      eventName ?? String(event.type ?? "tool_call"),
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

function extractGeminiToolCalls(events: JsonRecord[]) {
  const toolCalls: AgentToolCall[] = [];

  for (const event of events) {
    if (event.type === "content" || event.type === "message") {
      continue;
    }

    const eventName =
      typeof event.tool_name === "string"
        ? event.tool_name
        : typeof event.name === "string" && isToolLikeEventType(event.type)
          ? event.name
          : undefined;

    if (!eventName && !isToolLikeEventType(event.type)) {
      continue;
    }

    const normalized = normalizeToolCall(
      eventName ?? String(event.type ?? "tool_call"),
      event.input ?? event.arguments ?? event.request,
      event.output ?? event.result ?? event.response,
      event.duration_ms ?? event.durationMs
    );
    if (normalized) {
      toolCalls.push(normalized);
    }
  }

  return toolCalls;
}

function extractGeminiText(events: JsonRecord[]) {
  const assistantMessages = events
    .filter((event) => event.type === "message" && event.role === "assistant")
    .flatMap((event) => (typeof event.content === "string" ? [event.content] : []));

  if (assistantMessages.length === 0) {
    return "";
  }

  const lastMessage = assistantMessages[assistantMessages.length - 1]?.trim() ?? "";
  if (!lastMessage) {
    return "";
  }

  return lastMessage;
}

function applyCodexEventToRun(runId: string, event: JsonRecord) {
  const item = event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return;
  }

  const itemRecord = item as JsonRecord;
  if (itemRecord.type !== "command_execution" || typeof itemRecord.id !== "string") {
    return;
  }

  const itemId = itemRecord.id;
  const command = typeof itemRecord.command === "string" ? itemRecord.command : "command";
  const output =
    typeof itemRecord.aggregated_output === "string" ? itemRecord.aggregated_output : "";
  const exitCode = typeof itemRecord.exit_code === "number" ? itemRecord.exit_code : null;
  const status =
    event.type === "item.started"
      ? "running"
      : exitCode === 0
        ? "completed"
        : "failed";

  updateLocalAgentRun(runId, (run) => {
    const currentEvents = [...(run.commandEvents ?? [])];
    const existingIndex = currentEvents.findIndex((entry) => entry.id === itemId);
    const nextEvent: LocalAgentCommandRecord = {
      id: itemId,
      command,
      status,
      output: trimLog(output),
      exitCode
    };

    if (existingIndex >= 0) {
      currentEvents[existingIndex] = nextEvent;
    } else {
      currentEvents.push(nextEvent);
    }

    run.commandEvents = currentEvents;
  });
}

async function runManagedCommand(options: {
  runId: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  onStdoutChunk?: (value: string) => void;
}) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: process.cwd(),
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    updateLocalAgentRun(options.runId, (run) => {
      run.child = child;
      if (run.status === "queued") {
        run.status = "running";
      }
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      options.onStdoutChunk?.(value);
      updateLocalAgentRun(options.runId, (run) => {
        run.stdout = trimLog(run.stdout + value);
      });
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      updateLocalAgentRun(options.runId, (run) => {
        run.stderr = trimLog(run.stderr + value);
      });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      updateLocalAgentRun(options.runId, (run) => {
        run.child = undefined;
      });
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      const run = localAgentRuns.get(options.runId);
      updateLocalAgentRun(options.runId, (current) => {
        current.child = undefined;
      });

      if (run?.status === "cancelled" || signal === "SIGTERM" || signal === "SIGINT") {
        reject(new Error("run_cancelled"));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            stripAnsi(`${stderr}\n${stdout}`).trim() || `Process exited with code ${code ?? "unknown"}.`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function getCodexAuthStatus() {
  try {
    const result = await execFileAsync(codexCommand, ["login", "status"], {
      cwd: process.cwd(),
      env: process.env
    });
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
    codexAuthState = {
      ...codexAuthState,
      loggedIn: output.toLowerCase().includes("logged in"),
      statusText: output || "Logged in",
      error: undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex status check failed.";
    codexAuthState = {
      ...codexAuthState,
      loggedIn: false,
      statusText: "Not connected",
      error: message
    };
  }

  return codexAuthState;
}

function startCodexAuth() {
  if (codexAuthState.inProgress) {
    return codexAuthState;
  }

  codexAuthState = {
    loggedIn: false,
    inProgress: true,
    statusText: "Starting device login...",
    error: undefined,
    authUrl: undefined,
    code: undefined
  };

  const child = spawn(codexCommand, ["login", "--device-auth"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const handleChunk = (chunk: Buffer | string) => {
    const text = stripAnsi(chunk.toString()).trim();
    if (!text) {
      return;
    }

    const authUrl = extractFirstUrl(text);
    const code = extractDeviceCode(text);
    const nextUrl = authUrl ?? codexAuthState.authUrl;
    const nextCode = code ?? codexAuthState.code;

    codexAuthState = {
      ...codexAuthState,
      statusText: text,
      authUrl: nextUrl,
      code: nextCode
    };

    if (authUrl) {
      void shell.openExternal(authUrl);
    }
  };

  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);
  child.on("error", (error) => {
    codexAuthState = {
      ...codexAuthState,
      inProgress: false,
      loggedIn: false,
      error: error.message,
      statusText: "Codex login failed."
    };
  });
  child.on("close", async () => {
    codexAuthState = {
      ...codexAuthState,
      inProgress: false
    };
    await getCodexAuthStatus();
  });

  return codexAuthState;
}

function readJsonFile<T>(filePath: string) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function getGeminiCliStatus() {
  const resolvedCommand = getResolvedGeminiCommand();
  if (!resolvedCommand) {
    geminiCliState = {
      found: false,
      loggedIn: false,
      command: null,
      statusText: "Gemini CLI not found"
    };
    return geminiCliState;
  }

  const geminiDir = path.join(homedir(), ".gemini");
  const settings = readJsonFile<{ security?: { auth?: { selectedType?: string } } }>(
    path.join(geminiDir, "settings.json")
  );
  const accounts = readJsonFile<{ active?: string }>(path.join(geminiDir, "google_accounts.json"));
  const selectedType = settings?.security?.auth?.selectedType?.trim();
  const email = accounts?.active?.trim();
  const loggedIn = selectedType === "oauth-personal" && Boolean(email);

  geminiCliState = {
    found: true,
    loggedIn,
    command: resolvedCommand,
    email,
    statusText: loggedIn
      ? `Signed in with Google${email ? `: ${email}` : ""}`
      : selectedType && selectedType !== "oauth-personal"
        ? `Gemini CLI is configured for ${selectedType}, not Google sign-in.`
        : "Gemini CLI is installed, but Google sign-in is not complete.",
    error: undefined
  };

  return geminiCliState;
}

async function generateCodexReply(
  runId: string,
  messages: Array<{ role: string; content: string }>,
  model = "gpt-5"
) {
  const prompt = buildCliPrompt("Codex", messages);
  let stdout = "";
  let eventBuffer = "";

  try {
    const result = await runManagedCommand({
      runId,
      command: codexCommand,
      args: [
      "exec",
      "--skip-git-repo-check",
      "--full-auto",
      "--json",
      "-m",
      model,
      prompt
      ],
      env: process.env,
      onStdoutChunk: (value) => {
        eventBuffer += value;
        const lines = eventBuffer.split(/\r?\n/);
        eventBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            applyCodexEventToRun(runId, JSON.parse(trimmed) as JsonRecord);
          } catch {
            continue;
          }
        }
      }
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex CLI request failed.";
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
    model,
    content,
    toolCalls: extractCodexToolCalls(events)
  };
}

async function generateGeminiReply(
  runId: string,
  sessionId: string | undefined,
  messages: Array<{ role: string; content: string }>,
  model = defaultGeminiModel
) {
  const resolvedCommand = getResolvedGeminiCommand();
  if (!resolvedCommand) {
    throw new Error(
      "Gemini CLI not found. Install it with `npm install -g @google/gemini-cli`, then sign in with Google from `gemini`."
    );
  }

  const prompt = buildGeminiPrompt(messages);
  const args = [
    "--output-format",
    "stream-json",
    "--approval-mode",
    "yolo"
  ];
  const resumeSessionId = getGeminiResumeSessionId(sessionId);
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  args.push("-p", prompt);
  if (model && model.trim().length > 0 && model !== "auto") {
    args.push("-m", model);
  }

  let stdout = "";
  let stderr = "";
  try {
    const result = await runManagedCommand({
      runId,
      command: resolvedCommand,
      args,
      env: getGeminiEnv()
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    if (resumeSessionId && sessionId) {
      clearGeminiResumeSessionId(sessionId);
      const retryArgs = [
        "--output-format",
        "stream-json",
        "--approval-mode",
        "yolo",
        "-p",
        prompt,
        ...(model && model.trim().length > 0 && model !== "auto" ? ["-m", model] : [])
      ];
      try {
        const retryResult = await runManagedCommand({
          runId,
          command: resolvedCommand,
          args: retryArgs,
          env: getGeminiEnv()
        });
        stdout = retryResult.stdout;
        stderr = retryResult.stderr;
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : "Gemini CLI request failed.";
        throw new Error(`Gemini CLI request failed: ${retryMessage}`);
      }
    } else {
      const message = error instanceof Error ? error.message : "Gemini CLI request failed.";
      throw new Error(`Gemini CLI request failed: ${message}`);
    }
  }

  const events = parseJsonLines(stdout);
  const payload =
    [...events].reverse().find((event) => typeof event.response === "string" || typeof event.session_id === "string") ??
    extractJsonObject(stdout) ??
    extractJsonObject(stderr) ??
    extractJsonObject(`${stdout}\n${stderr}`);
  const parsedPayload =
    payload && typeof payload === "object"
      ? (payload as { response?: string; session_id?: string })
      : null;

  const content = parsedPayload?.response?.trim() || extractGeminiText(events);
  if (!content) {
    throw new Error("Gemini CLI returned an empty response.");
  }

  if (sessionId && !resumeSessionId && parsedPayload?.session_id?.trim()) {
    setGeminiResumeSessionId(sessionId, parsedPayload.session_id.trim());
  }

  return {
    provider: "gemini" as const,
    model,
    content,
    toolCalls: extractGeminiToolCalls(events)
  };
}

async function canUseCursor() {
  const cursorCommand = getResolvedCursorCommand();
  if (!cursorCommand) {
    return false;
  }

  try {
    await execFileAsync(cursorCommand, ["status"], {
      cwd: process.cwd(),
      env: getCursorEnv(cursorCommand)
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureCursorChatId(sessionId?: string) {
  if (!sessionId) {
    return null;
  }

  const existing = getCursorChatId(sessionId);
  if (existing) {
    return existing;
  }

  const cursorCommand = getResolvedCursorCommand();
  if (!cursorCommand) {
    return null;
  }

  const result = await execFileAsync(cursorCommand, ["create-chat"], {
    cwd: process.cwd(),
    env: getCursorEnv(cursorCommand)
  });
  const chatId = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
  if (!chatId) {
    throw new Error("Cursor CLI did not return a resumable chat id.");
  }

  setCursorChatId(sessionId, chatId);
  return chatId;
}

async function getCursorCliStatus() {
  const cursorCommand = getResolvedCursorCommand();
  if (!cursorCommand) {
    cursorCliState = {
      found: false,
      loggedIn: false,
      inProgress: false,
      command: null,
      statusText: "Cursor CLI not found"
    };
    return cursorCliState;
  }

  try {
    const result = await execFileAsync(cursorCommand, ["status"], {
      cwd: process.cwd(),
      env: getCursorEnv(cursorCommand)
    });
    const output = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
    cursorCliState = {
      found: true,
      loggedIn: !output.toLowerCase().includes("not logged in"),
      inProgress: cursorCliState.inProgress,
      command: cursorCommand,
      authUrl: cursorCliState.authUrl,
      statusText: output || "Cursor CLI available",
      error: undefined
    };
    return cursorCliState;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cursor CLI status check failed.";
    cursorCliState = {
      found: true,
      loggedIn: false,
      inProgress: cursorCliState.inProgress,
      command: cursorCommand,
      authUrl: cursorCliState.authUrl,
      statusText: message,
      error: message
    };
    return cursorCliState;
  }
}

function startCursorCliAuth() {
  if (cursorCliState.inProgress) {
    return cursorCliState;
  }

  const cursorCommand = getResolvedCursorCommand();
  if (!cursorCommand) {
    cursorCliState = {
      found: false,
      loggedIn: false,
      inProgress: false,
      command: null,
      statusText: "Cursor CLI not found",
      error: "Install Cursor CLI first."
    };
    return cursorCliState;
  }

  cursorCliState = {
    found: true,
    loggedIn: false,
    inProgress: true,
    command: cursorCommand,
    authUrl: undefined,
    statusText: "Starting Cursor CLI login...",
    error: undefined
  };

  const child = spawn(cursorCommand, ["login"], {
    cwd: process.cwd(),
    env: getCursorEnv(cursorCommand),
    stdio: ["ignore", "pipe", "pipe"]
  });

  const handleChunk = (chunk: Buffer | string) => {
    const text = stripAnsi(chunk.toString()).trim();
    if (!text) {
      return;
    }

    const authUrl = extractFirstUrl(text);
    cursorCliState = {
      ...cursorCliState,
      statusText: text,
      authUrl: authUrl ?? cursorCliState.authUrl
    };

    if (authUrl) {
      void shell.openExternal(authUrl);
    }
  };

  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);
  child.on("error", (error) => {
    cursorCliState = {
      ...cursorCliState,
      inProgress: false,
      loggedIn: false,
      error: error.message,
      statusText: "Cursor CLI login failed."
    };
  });
  child.on("close", async () => {
    cursorCliState = {
      ...cursorCliState,
      inProgress: false
    };
    await getCursorCliStatus();
  });

  return cursorCliState;
}

async function generateCursorReply(
  runId: string,
  sessionId: string | undefined,
  messages: Array<{ role: string; content: string }>,
  model = defaultCursorModel
) {
  const cursorCommand = getResolvedCursorCommand();
  if (!cursorCommand) {
    throw new Error(
      "Cursor CLI not found. Install it with `curl https://cursor.com/install -fsS | bash`, or set HAWKCODE_CURSOR_PATH to `agent` or `cursor-agent`."
    );
  }

  const prompt = buildCursorPrompt(messages);
  const chatId = await ensureCursorChatId(sessionId);
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--trust",
    "--force",
    "--approve-mcps"
  ];
  if (chatId) {
    args.push("--resume", chatId);
  }
  if (model && model.trim().length > 0 && model !== "auto") {
    args.push("-m", model);
  }
  args.push(prompt);

  let stdout: string;
  try {
    const result = await runManagedCommand({
      runId,
      command: cursorCommand,
      args,
      env: getCursorEnv(cursorCommand)
    });
    stdout = result.stdout;
  } catch (error) {
    if (chatId && sessionId) {
      clearCursorChatId(sessionId);
      const retryChatId = await ensureCursorChatId(sessionId);
      const retryArgs = [
        "--print",
        "--output-format",
        "stream-json",
        "--trust",
        "--force",
        "--approve-mcps",
        ...(retryChatId ? ["--resume", retryChatId] : []),
        ...(model && model.trim().length > 0 && model !== "auto" ? ["-m", model] : []),
        prompt
      ];
      try {
        const retryResult = await runManagedCommand({
          runId,
          command: cursorCommand,
          args: retryArgs,
          env: getCursorEnv(cursorCommand)
        });
        stdout = retryResult.stdout;
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : "Cursor CLI request failed.";
        throw new Error(`Cursor CLI request failed: ${retryMessage}`);
      }
    } else {
      const message = error instanceof Error ? error.message : "Cursor CLI request failed.";
      throw new Error(`Cursor CLI request failed: ${message}`);
    }
  }

  const events = parseJsonLines(stdout);
  const payload = [...events].reverse().find((event) => event.type === "result") as
    | { type?: string; subtype?: string; is_error?: boolean; result?: string }
    | undefined;
  if (!payload) {
    throw new Error("Cursor CLI returned invalid JSON.");
  }

  const content =
    payload.type === "result" && payload.subtype === "success" && !payload.is_error
      ? payload.result?.trim()
      : "";
  if (!content) {
    throw new Error("Cursor CLI returned an empty response.");
  }

  return {
    provider: "cursor" as const,
    model,
    content,
    toolCalls: extractCursorToolCalls(events)
  };
}

async function getDesktopAgentProviders() {
  const providers: Array<{ name: "codex" | "cursor" | "gemini"; label: string; defaultModel: string }> = [];
  const codexStatus = await getCodexAuthStatus();
  if (codexStatus.loggedIn) {
    providers.push({
      name: "codex",
      label: "Codex",
      defaultModel: "gpt-5"
    });
  }

  const geminiStatus = await getGeminiCliStatus();
  if (geminiStatus.loggedIn) {
    providers.push({
      name: "gemini",
      label: "Gemini CLI",
      defaultModel: defaultGeminiModel
    });
  }

  if (await canUseCursor()) {
    providers.push({
      name: "cursor",
      label: "Cursor CLI",
      defaultModel: defaultCursorModel
    });
  }

  return providers;
}

async function executeLocalAgentRun(runId: string, payload: {
  provider: "codex" | "cursor" | "gemini";
  sessionId?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
}) {
  try {
    const result =
      payload.provider === "codex"
        ? await generateCodexReply(runId, payload.messages, payload.model)
        : payload.provider === "gemini"
          ? await generateGeminiReply(runId, payload.sessionId, payload.messages, payload.model)
          : await generateCursorReply(runId, payload.sessionId, payload.messages, payload.model);

    updateLocalAgentRun(runId, (run) => {
      if (run.status === "cancelled") {
        run.finishedAt = run.finishedAt ?? toIsoNow();
        return;
      }
      run.status = "succeeded";
      run.finishedAt = toIsoNow();
      run.model = result.model;
      run.content = result.content;
      run.toolCalls = result.toolCalls;
    });
  } catch (error) {
    updateLocalAgentRun(runId, (run) => {
      if (run.status === "cancelled" || (error instanceof Error && error.message === "run_cancelled")) {
        run.status = "cancelled";
        run.finishedAt = run.finishedAt ?? toIsoNow();
        run.error = undefined;
        return;
      }
      run.status = "failed";
      run.finishedAt = toIsoNow();
      run.error = error instanceof Error ? error.message : "Agent run failed.";
    });
  }
}

function startLocalAgentRun(payload: {
  provider: "codex" | "cursor" | "gemini";
  sessionId?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
}) {
  const prompt = payload.messages[payload.messages.length - 1]?.content?.trim() ?? "";
  const run: LocalAgentRunState = {
    id: createLocalAgentRunId(),
    provider: payload.provider,
    sessionId: payload.sessionId,
    model:
      payload.model?.trim() ||
      (payload.provider === "codex"
        ? "gpt-5"
        : payload.provider === "cursor"
          ? defaultCursorModel
          : defaultGeminiModel),
    status: "queued",
    startedAt: toIsoNow(),
    prompt,
    stdout: "",
    stderr: "",
    commandEvents: []
  };

  rememberLocalAgentRun(run);
  void executeLocalAgentRun(run.id, payload);
  return serializeLocalAgentRun(run);
}

function listLocalAgentRunRecords() {
  return [...localAgentRuns.values()]
    .map((run) => serializeLocalAgentRun(run))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function stopLocalAgentRun(runId: string) {
  const run = localAgentRuns.get(runId);
  if (!run) {
    return { ok: false };
  }

  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
    return { ok: true };
  }

  run.status = "cancelled";
  run.finishedAt = toIsoNow();
  run.child?.kill("SIGTERM");
  rememberLocalAgentRun(run);
  return { ok: true };
}

async function getDesktopAgentProviderDebug() {
  const cursorCommand = getResolvedCursorCommand();
  const codexStatus = await getCodexAuthStatus();

  let cursorStatusOutput = "";
  let cursorStatusOk = false;
  if (cursorCommand) {
    try {
      const result = await execFileAsync(cursorCommand, ["status"], {
        cwd: process.cwd(),
        env: getCursorEnv(cursorCommand)
      });
      cursorStatusOk = true;
      cursorStatusOutput = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
    } catch (error) {
      cursorStatusOutput = error instanceof Error ? error.message : "cursor_status_failed";
    }
  }

  return {
    cwd: process.cwd(),
    home: process.env.HOME ?? null,
    path: process.env.PATH ?? "",
    codexCommand,
    codexStatus,
    cursorCommand,
    cursorStatusOk,
    cursorStatusOutput,
    detectedProviders: await getDesktopAgentProviders()
  };
}

function createWindow() {
  const preloadPathCjs = path.join(__dirname, "../preload/index.cjs");
  const preloadPathMjs = path.join(__dirname, "../preload/index.mjs");
  const preloadPathJs = path.join(__dirname, "../preload/index.js");
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#f6f3ee",
    webPreferences: {
      preload: fs.existsSync(preloadPathCjs)
        ? preloadPathCjs
        : fs.existsSync(preloadPathMjs)
        ? preloadPathMjs
        : preloadPathJs
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function normalizeUrl(url: string) {
  return url.replace(/\/$/, "");
}

async function checkHealth(url: string) {
  const checkedAt = new Date().toISOString();
  return new Promise<{ ok: boolean; status?: number; error?: string; checkedAt: string }>(
    (resolve) => {
      try {
        const request = net.request(`${normalizeUrl(url)}/health`);
        request.on("response", (response) => {
          const status = response.statusCode ?? 0;
          resolve({ ok: status >= 200 && status < 300, status, checkedAt });
        });
        request.on("error", (error) => {
          resolve({ ok: false, error: error.message, checkedAt });
        });
        request.end();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        resolve({ ok: false, error: message, checkedAt });
      }
    }
  );
}

app.whenReady().then(() => {
  if (allowSelfSigned) {
    session.defaultSession.setCertificateVerifyProc((_request, callback) => {
      callback(0);
    });
  }
  app.on(
    "certificate-error",
    (event, _webContents, url, _error, certificate, callback) => {
      const hostname = new URL(url).hostname;
      if (allowSelfSigned) {
        event.preventDefault();
        callback(true);
        return;
      }
      const trusted = store.get("trustedCerts") ?? {};
      if (trusted[hostname] === certificate.fingerprint) {
        event.preventDefault();
        callback(true);
        return;
      }
      pendingCerts.set(hostname, {
        fingerprint: certificate.fingerprint,
        issuerName: certificate.issuerName,
        validStart: certificate.validStart,
        validExpiry: certificate.validExpiry
      });
      event.preventDefault();
      callback(false);
    }
  );

  ipcMain.handle("hawkcode:get-server-config", () => ({
    serverUrl: store.get("serverUrl") ?? ""
  }));

  ipcMain.handle("hawkcode:set-server-url", (_event, url: string) => {
    store.set("serverUrl", url);
    return { ok: true };
  });

  ipcMain.handle("hawkcode:check-health", async (_event, url: string) => {
    return checkHealth(url);
  });

  ipcMain.handle("hawkcode:get-pending-cert", (_event, hostname: string) => {
    return pendingCerts.get(hostname) ?? null;
  });

  ipcMain.handle("hawkcode:trust-cert", (_event, hostname: string) => {
    const pending = pendingCerts.get(hostname);
    if (!pending) return { ok: false };
    const trusted = store.get("trustedCerts") ?? {};
    trusted[hostname] = pending.fingerprint;
    store.set("trustedCerts", trusted);
    pendingCerts.delete(hostname);
    return { ok: true };
  });

  ipcMain.handle("hawkcode:get-codex-auth-status", async () => {
    return getCodexAuthStatus();
  });

  ipcMain.handle("hawkcode:get-gemini-cli-status", async () => {
    return getGeminiCliStatus();
  });

  ipcMain.handle("hawkcode:get-cursor-cli-status", async () => {
    return getCursorCliStatus();
  });

  ipcMain.handle("hawkcode:start-codex-auth", async () => {
    return startCodexAuth();
  });

  ipcMain.handle("hawkcode:start-cursor-cli-auth", async () => {
    return startCursorCliAuth();
  });


  ipcMain.handle("hawkcode:open-external-url", async (_event, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("hawkcode:start-local-agent-run", async (_event, payload) => {
    return startLocalAgentRun(payload);
  });

  ipcMain.handle("hawkcode:list-local-agent-runs", async () => {
    return listLocalAgentRunRecords();
  });

  ipcMain.handle("hawkcode:stop-local-agent-run", async (_event, runId: string) => {
    return stopLocalAgentRun(runId);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

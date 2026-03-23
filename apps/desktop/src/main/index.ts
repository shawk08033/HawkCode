import { app, BrowserWindow, ipcMain, net, session, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir, userInfo } from "node:os";
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

function extractFirstUrl(value: string) {
  return value.match(/https?:\/\/\S+/)?.[0];
}

function extractDeviceCode(value: string) {
  return value.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
}

function stripAnsi(value: string) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
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
    "Do not modify files, run shell commands, or make tool calls.",
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
    "Do not modify files, run shell commands, or make tool calls.",
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
    "Do not modify files, run shell commands, or make tool calls.",
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

async function generateCodexReply(messages: Array<{ role: string; content: string }>, model = "gpt-5") {
  const outputFile = path.join(
    await fsp.mkdtemp(path.join(tmpdir(), "hawkcode-desktop-codex-")),
    "last-message.txt"
  );
  const prompt = buildCliPrompt("Codex", messages);

  try {
    await execFileAsync(codexCommand, [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputFile,
      "-m",
      model,
      prompt
    ], {
      cwd: process.cwd(),
      env: process.env
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex CLI request failed.";
    throw new Error(`Codex CLI request failed: ${message}`);
  }

  const content = (await fsp.readFile(outputFile, "utf8")).trim();
  if (!content) {
    throw new Error("Codex returned an empty response.");
  }

  return {
    provider: "codex" as const,
    model,
    content
  };
}

async function generateGeminiReply(
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
    "json",
    "--approval-mode",
    "plan"
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
    const result = await execFileAsync(resolvedCommand, args, {
      cwd: process.cwd(),
      env: getGeminiEnv()
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    if (resumeSessionId && sessionId) {
      clearGeminiResumeSessionId(sessionId);
      const retryArgs = [
        "--output-format",
        "json",
        "--approval-mode",
        "plan",
        "-p",
        prompt,
        ...(model && model.trim().length > 0 && model !== "auto" ? ["-m", model] : [])
      ];
      try {
        const retryResult = await execFileAsync(resolvedCommand, retryArgs, {
          cwd: process.cwd(),
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

  let payload: { response?: string; session_id?: string };
  const parsed = extractJsonObject(stdout) ?? extractJsonObject(stderr) ?? extractJsonObject(`${stdout}\n${stderr}`);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini CLI returned invalid JSON.");
  }
  payload = parsed as { response?: string; session_id?: string };

  const content = payload.response?.trim() ?? "";
  if (!content) {
    throw new Error("Gemini CLI returned an empty response.");
  }

  if (sessionId && !resumeSessionId && payload.session_id?.trim()) {
    setGeminiResumeSessionId(sessionId, payload.session_id.trim());
  }

  return {
    provider: "gemini" as const,
    model,
    content
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
    "-p",
    "--output-format",
    "json",
    "--trust",
    "--mode",
    "ask"
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
    const result = await execFileAsync(cursorCommand, args, {
      cwd: process.cwd(),
      env: getCursorEnv(cursorCommand)
    });
    stdout = result.stdout;
  } catch (error) {
    if (chatId && sessionId) {
      clearCursorChatId(sessionId);
      const retryChatId = await ensureCursorChatId(sessionId);
      const retryArgs = [
        "-p",
        "--output-format",
        "json",
        "--trust",
        "--mode",
        "ask",
        ...(retryChatId ? ["--resume", retryChatId] : []),
        ...(model && model.trim().length > 0 && model !== "auto" ? ["-m", model] : []),
        prompt
      ];
      try {
        const retryResult = await execFileAsync(cursorCommand, retryArgs, {
          cwd: process.cwd(),
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

  let payload: { type?: string; subtype?: string; is_error?: boolean; result?: string };
  try {
    payload = JSON.parse(stdout) as { type?: string; subtype?: string; is_error?: boolean; result?: string };
  } catch {
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
    content
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

  ipcMain.handle("hawkcode:generate-local-agent-reply", async (_event, payload) => {
    if (payload.provider === "codex") {
      return generateCodexReply(payload.messages, payload.model);
    }
    if (payload.provider === "gemini") {
      return generateGeminiReply(payload.sessionId, payload.messages, payload.model);
    }
    if (payload.provider === "cursor") {
      return generateCursorReply(payload.sessionId, payload.messages, payload.model);
    }
    throw new Error(`Unsupported local provider: ${payload.provider as string}`);
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

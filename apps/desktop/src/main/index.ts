import { app, BrowserWindow, ipcMain, net, session, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
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
};

type PendingCert = {
  fingerprint: string;
  issuerName?: string;
  validStart?: number;
  validExpiry?: number;
};

const store = new Store<StoreShape>({
  defaults: {
    trustedCerts: {}
  }
});

const devServerUrl = isDev ? process.env.HAWKCODE_SERVER_URL?.trim() : undefined;
if (devServerUrl) {
  store.set("serverUrl", devServerUrl.replace(/\/$/, ""));
}

const pendingCerts = new Map<string, PendingCert>();
const codexCommand = "codex";
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

function extractFirstUrl(value: string) {
  return value.match(/https?:\/\/\S+/)?.[0];
}

function extractDeviceCode(value: string) {
  return value.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
}

function stripAnsi(value: string) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
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

async function generateCodexReply(messages: Array<{ role: string; content: string }>, model = "gpt-5") {
  const outputFile = path.join(
    await fsp.mkdtemp(path.join(tmpdir(), "hawkcode-desktop-codex-")),
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

  ipcMain.handle("hawkcode:start-codex-auth", async () => {
    return startCodexAuth();
  });

  ipcMain.handle("hawkcode:open-external-url", async (_event, url: string) => {
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("hawkcode:generate-codex-reply", async (_event, payload) => {
    return generateCodexReply(payload.messages, payload.model);
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

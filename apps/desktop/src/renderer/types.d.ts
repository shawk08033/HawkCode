type PendingCert = {
  fingerprint: string;
  issuerName?: string;
  validStart?: string;
  validExpiry?: string;
};

type HealthStatus = {
  ok: boolean;
  status?: number;
  error?: string;
  checkedAt: string;
};

type CodexAuthStatus = {
  loggedIn: boolean;
  inProgress: boolean;
  authUrl?: string;
  code?: string;
  statusText?: string;
  error?: string;
};

type CursorCliStatus = {
  found: boolean;
  loggedIn: boolean;
  inProgress: boolean;
  command: string | null;
  authUrl?: string;
  statusText: string;
  error?: string;
};

type GeminiCliStatus = {
  found: boolean;
  loggedIn: boolean;
  command: string | null;
  email?: string;
  statusText: string;
  error?: string;
};

type CodexGeneratePayload = {
  provider: "codex" | "cursor" | "gemini";
  sessionId?: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
};

type LocalAgentRun = {
  id: string;
  provider: "codex" | "cursor" | "gemini";
  sessionId?: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  prompt: string;
  content?: string;
  error?: string;
  stdout: string;
  stderr: string;
  commandEvents?: Array<{
    id: string;
    command: string;
    status: "running" | "completed" | "failed";
    output: string;
    exitCode?: number | null;
  }>;
  toolCalls?: Array<{
    name: string;
    input?: string;
    output?: string;
    durationMs?: number;
  }>;
};

declare global {
  interface Window {
    hawkcode: {
      version: string;
      getServerConfig: () => Promise<{ serverUrl: string }>;
      setServerUrl: (url: string) => Promise<{ ok: boolean }>;
      checkHealth: (url: string) => Promise<HealthStatus>;
      getPendingCert: (hostname: string) => Promise<PendingCert | null>;
      trustCert: (hostname: string) => Promise<{ ok: boolean }>;
      getCodexAuthStatus: () => Promise<CodexAuthStatus>;
      getGeminiCliStatus: () => Promise<GeminiCliStatus>;
      getCursorCliStatus: () => Promise<CursorCliStatus>;
      startCodexAuth: () => Promise<CodexAuthStatus>;
      startCursorCliAuth: () => Promise<CursorCliStatus>;
      openExternalUrl: (url: string) => Promise<{ ok: boolean }>;
      startLocalAgentRun: (payload: CodexGeneratePayload) => Promise<LocalAgentRun>;
      listLocalAgentRuns: () => Promise<LocalAgentRun[]>;
      stopLocalAgentRun: (runId: string) => Promise<{ ok: boolean }>;
    };
  }
}

export {};

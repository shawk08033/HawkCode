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
  messages: Array<{ role: string; content: string }>;
  model?: string;
};

type CodexGenerateResult = {
  provider: "codex" | "cursor" | "gemini";
  model: string;
  content: string;
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
      generateLocalAgentReply: (payload: CodexGeneratePayload) => Promise<CodexGenerateResult>;
    };
  }
}

export {};

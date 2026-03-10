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

type CodexGeneratePayload = {
  messages: Array<{ role: string; content: string }>;
  model?: string;
};

type CodexGenerateResult = {
  provider: "codex";
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
      startCodexAuth: () => Promise<CodexAuthStatus>;
      openExternalUrl: (url: string) => Promise<{ ok: boolean }>;
      generateCodexReply: (payload: CodexGeneratePayload) => Promise<CodexGenerateResult>;
    };
  }
}

export {};

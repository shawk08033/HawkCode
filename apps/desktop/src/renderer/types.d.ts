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

declare global {
  interface Window {
    hawkcode: {
      version: string;
      getServerConfig: () => Promise<{ serverUrl: string }>;
      setServerUrl: (url: string) => Promise<{ ok: boolean }>;
      checkHealth: (url: string) => Promise<HealthStatus>;
      getPendingCert: (hostname: string) => Promise<PendingCert | null>;
      trustCert: (hostname: string) => Promise<{ ok: boolean }>;
    };
  }
}

export {};

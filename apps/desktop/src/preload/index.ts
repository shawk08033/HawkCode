import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hawkcode", {
  version: "0.1.0",
  getServerConfig: () => ipcRenderer.invoke("hawkcode:get-server-config"),
  setServerUrl: (url: string) => ipcRenderer.invoke("hawkcode:set-server-url", url),
  checkHealth: (url: string) => ipcRenderer.invoke("hawkcode:check-health", url),
  getPendingCert: (hostname: string) =>
    ipcRenderer.invoke("hawkcode:get-pending-cert", hostname),
  trustCert: (hostname: string) => ipcRenderer.invoke("hawkcode:trust-cert", hostname),
  getCodexAuthStatus: () => ipcRenderer.invoke("hawkcode:get-codex-auth-status"),
  getGeminiCliStatus: () => ipcRenderer.invoke("hawkcode:get-gemini-cli-status"),
  getCursorCliStatus: () => ipcRenderer.invoke("hawkcode:get-cursor-cli-status"),
  startCodexAuth: () => ipcRenderer.invoke("hawkcode:start-codex-auth"),
  startCursorCliAuth: () => ipcRenderer.invoke("hawkcode:start-cursor-cli-auth"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("hawkcode:open-external-url", url),
  startLocalAgentRun: (payload: {
    provider: "codex" | "cursor" | "gemini";
    sessionId?: string;
    messages: Array<{ role: string; content: string }>;
    model?: string;
  }) => ipcRenderer.invoke("hawkcode:start-local-agent-run", payload),
  listLocalAgentRuns: () => ipcRenderer.invoke("hawkcode:list-local-agent-runs"),
  stopLocalAgentRun: (runId: string) => ipcRenderer.invoke("hawkcode:stop-local-agent-run", runId)
});

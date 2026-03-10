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
  startCodexAuth: () => ipcRenderer.invoke("hawkcode:start-codex-auth"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("hawkcode:open-external-url", url),
  generateCodexReply: (payload: { messages: Array<{ role: string; content: string }>; model?: string }) =>
    ipcRenderer.invoke("hawkcode:generate-codex-reply", payload)
});

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hawkcode", {
  version: "0.1.0",
  getServerConfig: () => ipcRenderer.invoke("hawkcode:get-server-config"),
  setServerUrl: (url: string) => ipcRenderer.invoke("hawkcode:set-server-url", url),
  checkHealth: (url: string) => ipcRenderer.invoke("hawkcode:check-health", url),
  getPendingCert: (hostname: string) =>
    ipcRenderer.invoke("hawkcode:get-pending-cert", hostname),
  trustCert: (hostname: string) => ipcRenderer.invoke("hawkcode:trust-cert", hostname)
});

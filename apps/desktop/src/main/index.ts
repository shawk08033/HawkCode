import { app, BrowserWindow, ipcMain, net } from "electron";
import path from "node:path";
import Store from "electron-store";

const isDev = !app.isPackaged;

type StoreShape = {
  serverUrl?: string;
  trustedCerts?: Record<string, string>;
};

type PendingCert = {
  fingerprint: string;
  issuerName?: string;
  validStart?: string;
  validExpiry?: string;
};

const store = new Store<StoreShape>({
  defaults: {
    trustedCerts: {}
  }
});

const pendingCerts = new Map<string, PendingCert>();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#f6f3ee",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js")
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
  app.on(
    "certificate-error",
    (event, _webContents, url, _error, certificate, callback) => {
      const hostname = new URL(url).hostname;
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

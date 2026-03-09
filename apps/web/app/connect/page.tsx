"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, TextField } from "@hawkcode/ui";
import { checkHealth } from "@hawkcode/shared";

type Status = {
  state: "idle" | "checking" | "ok" | "error";
  message?: string;
  checkedAt?: string;
};

const DEFAULT_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://localhost:3001";
const IS_DEV = process.env.NODE_ENV === "development";

function formatTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString();
}

export default function ConnectPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    let interval: number | undefined;
    if (status.state === "ok") {
      interval = window.setInterval(() => {
        void handleCheck();
      }, 30000);
    }
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [status.state]);

  async function handleCheck() {
    if (serverUrl.startsWith("http://") && !IS_DEV) {
      setStatus({
        state: "error",
        message: "TLS required. Use https://",
        checkedAt: new Date().toISOString()
      });
      return;
    }

    setStatus({ state: "checking" });
    const result = await checkHealth(serverUrl);
    if (result.ok) {
      window.localStorage.setItem("hawkcode.serverUrl", serverUrl);
      setStatus({ state: "ok", checkedAt: result.checkedAt });
    } else {
      setStatus({
        state: "error",
        message: result.error ?? "Health check failed",
        checkedAt: result.checkedAt
      });
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="header">
          <Badge label="Connect" />
          <h1>Connect to your HawkCode server.</h1>
          <p>We will check the health endpoint before saving the URL.</p>
        </div>
      </section>
      <section className="grid">
        <Card
          title="Server URL"
          description={
            IS_DEV
              ? "TLS recommended. HTTP allowed in development only."
              : "TLS-only. Web requires a trusted certificate."
          }
        >
          <div className="stack">
            <TextField
              label="Server URL"
              placeholder={DEFAULT_URL}
              value={serverUrl}
              onChange={setServerUrl}
            />
          <div className="actions">
            <Button
              label={status.state === "checking" ? "Checking..." : "Test connection"}
              onClick={handleCheck}
            />
            {status.state === "ok" ? (
              <Button
                label="Continue to login"
                variant="outline"
                onClick={() => (window.location.href = "/login")}
              />
            ) : null}
          </div>
          </div>
        </Card>
        <Card title="Status">
          <div className="status">
            <span>{status.state === "ok" ? "Connected" : "Not connected"}</span>
            {status.message ? <span className="error">{status.message}</span> : null}
            {status.checkedAt ? (
              <span className="time">Last checked {formatTime(status.checkedAt)}</span>
            ) : null}
          </div>
        </Card>
      </section>
    </main>
  );
}

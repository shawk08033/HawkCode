"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, TextField } from "@hawkcode/ui";

type InviteInfo = {
  workspace: string;
  role: string;
  email?: string | null;
};

type Status = {
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
};

const DEFAULT_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://localhost:3001";
const IS_DEV = process.env.NODE_ENV === "development";

export default function InvitePage({ params }: { params: { token: string } }) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    async function fetchInvite() {
      if (!serverUrl || serverUrl.startsWith("http://")) {
        return;
      }
      try {
        const response = await fetch(
          `${serverUrl.replace(/\/$/, "")}/auth/invite/${params.token}`,
          {
            method: "GET",
            credentials: "include"
          }
        );
        if (!response.ok) {
          setStatus({ state: "error", message: "Invite not found." });
          return;
        }
        const data = (await response.json()) as InviteInfo;
        setInvite(data);
        if (data.email) {
          setEmail(data.email);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invite not found.";
        setStatus({ state: "error", message });
      }
    }
    void fetchInvite();
  }, [serverUrl, params.token]);

  async function handleAccept() {
    if (serverUrl.startsWith("http://") && !IS_DEV) {
      setStatus({ state: "error", message: "TLS required. Use https://" });
      return;
    }
    setStatus({ state: "loading" });
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: params.token, email, password })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = body.error as string | undefined;
        const message =
          error === "invite_not_found"
            ? "Invite not found or expired."
            : error === "invite_email_mismatch"
            ? "Email does not match the invite."
            : error === "password_too_short"
            ? "Password must be at least 8 characters."
            : error === "user_exists"
            ? "A user with this email already exists."
            : "Invite acceptance failed.";
        setStatus({ state: "error", message });
        return;
      }
      window.localStorage.setItem("hawkcode.serverUrl", serverUrl);
      setStatus({ state: "ok", message: "Invite accepted." });
      window.location.href = "/app";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invite acceptance failed.";
      setStatus({ state: "error", message });
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="header">
          <Badge label="Invite" />
          <h1>Accept your workspace invite.</h1>
          <p>Invites are single-use and require a secure connection.</p>
        </div>
      </section>
      <section className="grid">
        <Card
          title="Invite details"
          description={invite ? `${invite.workspace} • ${invite.role}` : "Loading..."}
        >
          <div className="stack">
            <TextField label="Server URL" value={serverUrl} onChange={setServerUrl} />
            <TextField label="Email" type="email" value={email} onChange={setEmail} />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              helpText="At least 8 characters"
            />
            <div className="actions">
              <Button
                label={status.state === "loading" ? "Accepting..." : "Accept invite"}
                onClick={handleAccept}
              />
            </div>
            {status.message ? (
              <span className={status.state === "error" ? "error" : "time"}>
                {status.message}
              </span>
            ) : null}
          </div>
        </Card>
      </section>
    </main>
  );
}

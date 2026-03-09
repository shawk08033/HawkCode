import { useEffect, useState } from "react";
import { Badge, Button, Card, Modal, SelectField, TextField } from "@hawkcode/ui";

type Status = {
  state: "idle" | "checking" | "ok" | "error";
  message?: string;
  checkedAt?: string;
};

type PendingCert = {
  fingerprint: string;
  issuerName?: string;
  validStart?: string;
  validExpiry?: string;
};

const DEFAULT_URL = "https://localhost:3001";

function formatTime(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString();
}

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [pendingCert, setPendingCert] = useState<PendingCert | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [newInviteEmail, setNewInviteEmail] = useState("");
  const [newInviteRole, setNewInviteRole] = useState("viewer");
  const [newInviteDays, setNewInviteDays] = useState("7");
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);
  const [newInviteError, setNewInviteError] = useState<string | null>(null);
  const [invites, setInvites] = useState<
    Array<{
      id: string;
      token: string;
      role: string;
      email?: string | null;
      expiresAt: string;
      acceptedAt?: string | null;
    }>
  >([]);
  const [inviteListMessage, setInviteListMessage] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteFilter, setInviteFilter] = useState("all");
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email?: string | null } | null>(null);

  useEffect(() => {
    window.hawkcode.getServerConfig().then((config) => {
      if (config.serverUrl) {
        setServerUrl(config.serverUrl);
      }
    });
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/me`, {
          method: "GET",
          credentials: "include"
        });
        if (response.ok) {
          const data = await response.json();
          setAuthUser(data.user?.email ?? null);
        } else {
          setAuthUser(null);
        }
      } catch {
        setAuthUser(null);
      }
    }
    if (serverUrl) {
      void checkAuth();
    }
  }, [serverUrl]);

  async function fetchInvites() {
    setInviteListMessage(null);
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setInviteListMessage(body.error ?? "Failed to load invites.");
        return;
      }
      const body = await response.json();
      setInvites(body.invites ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load invites.";
      setInviteListMessage(message);
    }
  }

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
  }, [status.state, serverUrl]);

  async function handleCheck() {
    if (serverUrl.startsWith("http://")) {
      setStatus({
        state: "error",
        message: "TLS required. Use https://",
        checkedAt: new Date().toISOString()
      });
      return;
    }

    setStatus({ state: "checking" });
    const result = await window.hawkcode.checkHealth(serverUrl);
    if (result.ok) {
      await window.hawkcode.setServerUrl(serverUrl);
      setPendingCert(null);
      setStatus({ state: "ok", checkedAt: result.checkedAt });
      return;
    }

    setStatus({
      state: "error",
      message: result.error ?? "Health check failed",
      checkedAt: result.checkedAt
    });

    try {
      const hostname = new URL(serverUrl).hostname;
      const pending = await window.hawkcode.getPendingCert(hostname);
      setPendingCert(pending);
    } catch {
      setPendingCert(null);
    }
  }

  async function handleTrust() {
    try {
      const hostname = new URL(serverUrl).hostname;
      const result = await window.hawkcode.trustCert(hostname);
      if (result.ok) {
        setPendingCert(null);
        await handleCheck();
      }
    } catch {
      setPendingCert(null);
    }
  }

  async function handleLogin() {
    setAuthMessage(null);
    if (serverUrl.startsWith("http://")) {
      setAuthMessage("TLS required. Use https://");
      return;
    }
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        setAuthMessage("Login failed.");
        return;
      }
      const data = await response.json();
      setAuthUser(data.user?.email ?? null);
      setAuthMessage("Logged in.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed.";
      setAuthMessage(message);
    }
  }

  async function handleInviteAccept() {
    setInviteMessage(null);
    if (serverUrl.startsWith("http://")) {
      setInviteMessage("TLS required. Use https://");
      return;
    }
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/invite/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: inviteToken, email: inviteEmail, password: invitePassword })
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
        setInviteMessage(message);
        return;
      }
      const data = await response.json();
      setAuthUser(data.user?.email ?? null);
      setInviteMessage("Invite accepted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invite acceptance failed.";
      setInviteMessage(message);
    }
  }

  async function handleCreateInvite() {
    setNewInviteError(null);
    setNewInviteLink(null);
    if (serverUrl.startsWith("http://")) {
      setNewInviteError("TLS required. Use https://");
      return;
    }
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: newInviteEmail || undefined,
          role: newInviteRole,
          expiresInDays: Number(newInviteDays) || 7
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setNewInviteError(body.error ?? "Invite creation failed.");
        return;
      }
      const body = await response.json();
      const token = body.token as string;
      const link = `invite/${token}`;
      setNewInviteLink(link);
      await fetchInvites();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invite creation failed.";
      setNewInviteError(message);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setInviteListMessage("Copied to clipboard.");
    } catch {
      setInviteListMessage("Copy failed.");
    }
  }

  async function handleRevokeInvite(id: string) {
    setInviteListMessage(null);
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setInviteListMessage(body.error ?? "Failed to revoke invite.");
        return;
      }
      await fetchInvites();
      setRevokeTarget(null);
      setInviteListMessage("Invite revoked.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke invite.";
      setInviteListMessage(message);
    }
  }

  const filteredInvites = invites.filter((invite) => {
    const status = invite.acceptedAt
      ? "accepted"
      : new Date(invite.expiresAt) < new Date()
      ? "expired"
      : "active";
    const matchesFilter = inviteFilter === "all" || status === inviteFilter;
    const query = inviteQuery.toLowerCase();
    const matchesQuery =
      !query ||
      (invite.email ?? "").toLowerCase().includes(query) ||
      invite.token.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });

  async function handleLogout() {
    try {
      await fetch(`${serverUrl.replace(/\/$/, "")}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } finally {
      setAuthUser(null);
      setAuthMessage("Signed out.");
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="header">
          <Badge label="HawkCode Desktop" />
          <h1>Collaborative agent workspaces.</h1>
          <p>Run sessions locally while syncing with your private server.</p>
        </div>
      </section>
      <section className="grid">
        <Card title="Server URL" description="TLS-only. You can trust self-signed certs.">
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
              {pendingCert ? (
                <Button label="Trust certificate" variant="outline" onClick={handleTrust} />
              ) : null}
            </div>
          </div>
        </Card>
        <Card title="Status">
          <div className="status">
            <span>{status.state === "ok" ? "Connected" : "Not connected"}</span>
            {status.message ? <span className="error">{status.message}</span> : null}
            {pendingCert ? (
              <span className="warning">
                Self-signed certificate detected. Trust to continue.
              </span>
            ) : null}
            {status.checkedAt ? (
              <span className="time">Last checked {formatTime(status.checkedAt)}</span>
            ) : null}
          </div>
        </Card>
        <Card title="Login" description="Invite-only access.">
          <div className="stack">
            <TextField label="Email" type="email" value={email} onChange={setEmail} />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
            />
            <div className="actions">
              <Button label="Sign in" onClick={handleLogin} />
              <Button label="Sign out" variant="outline" onClick={handleLogout} />
            </div>
            {authUser ? <span className="time">Signed in as {authUser}</span> : null}
            {authMessage ? (
              <span className={authMessage.includes("failed") ? "error" : "time"}>
                {authMessage}
              </span>
            ) : null}
          </div>
        </Card>
        <Card title="Accept invite" description="Use your invite token to join.">
          <div className="stack">
            <TextField
              label="Invite token"
              value={inviteToken}
              onChange={setInviteToken}
            />
            <TextField
              label="Email"
              type="email"
              value={inviteEmail}
              onChange={setInviteEmail}
            />
            <TextField
              label="Password"
              type="password"
              value={invitePassword}
              onChange={setInvitePassword}
            />
            <div className="actions">
              <Button label="Accept invite" onClick={handleInviteAccept} />
            </div>
            {inviteMessage ? (
              <span className={inviteMessage.includes("failed") ? "error" : "time"}>
                {inviteMessage}
              </span>
            ) : null}
          </div>
        </Card>
        <Card title="Create invite" description="Invite a teammate to your workspace.">
          <div className="stack">
            <TextField
              label="Invite email (optional)"
              value={newInviteEmail}
              onChange={setNewInviteEmail}
            />
            <SelectField
              label="Role"
              value={newInviteRole}
              onChange={setNewInviteRole}
              options={[
                { label: "Viewer", value: "viewer" },
                { label: "Maintainer", value: "maintainer" }
              ]}
            />
            <TextField
              label="Expires in days"
              value={newInviteDays}
              onChange={setNewInviteDays}
              helpText="1 to 30 days"
            />
            <div className="actions">
              <Button label="Create invite" onClick={handleCreateInvite} />
            </div>
            {newInviteLink ? (
              <span className="time">Invite token: {newInviteLink}</span>
            ) : null}
            {newInviteError ? <span className="error">{newInviteError}</span> : null}
          </div>
        </Card>
        <Card title="My invites" description="Manage active invites.">
          <div className="stack">
            <div className="actions">
              <Button label="Refresh" variant="outline" onClick={fetchInvites} />
            </div>
            <div className="filters">
              <TextField
                label="Search"
                value={inviteQuery}
                onChange={setInviteQuery}
                placeholder="Email or token"
              />
              <SelectField
                label="Status"
                value={inviteFilter}
                onChange={setInviteFilter}
                options={[
                  { label: "All", value: "all" },
                  { label: "Active", value: "active" },
                  { label: "Expired", value: "expired" },
                  { label: "Accepted", value: "accepted" }
                ]}
              />
            </div>
            {inviteListMessage ? <span className="time">{inviteListMessage}</span> : null}
            {filteredInvites.length === 0 ? (
              <span className="time">No invites yet.</span>
            ) : (
              <div className="invite-list">
                {filteredInvites.map((invite) => {
                  const status = invite.acceptedAt
                    ? "Accepted"
                    : new Date(invite.expiresAt) < new Date()
                    ? "Expired"
                    : "Active";
                  return (
                    <div key={invite.token} className="invite-row">
                      <div className="invite-main">
                        <span>{invite.email ?? "No email"}</span>
                        <span className="time">{invite.role}</span>
                      </div>
                      <span className="time">{status}</span>
                      <div className="invite-actions">
                        <span className="time">Token: {invite.token}</span>
                        <div className="actions">
                          <Button
                            label="Copy token"
                            variant="outline"
                            onClick={() => handleCopy(invite.token)}
                          />
                          <Button
                            label="Revoke"
                            variant="outline"
                            onClick={() => setRevokeTarget({ id: invite.id, email: invite.email })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </section>
      <Modal
        open={Boolean(revokeTarget)}
        title="Revoke invite"
        description="This will invalidate the invite immediately."
        onClose={() => setRevokeTarget(null)}
      >
        <div className="stack">
          <span className="time">
            {revokeTarget?.email ?? "No email"}
          </span>
          <div className="actions">
            <Button
              label="Cancel"
              variant="outline"
              onClick={() => setRevokeTarget(null)}
            />
            <Button
              label="Revoke invite"
              onClick={() => revokeTarget && handleRevokeInvite(revokeTarget.id)}
            />
          </div>
        </div>
      </Modal>
    </main>
  );
}

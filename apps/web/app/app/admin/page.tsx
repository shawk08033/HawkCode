"use client";

import { useEffect, useState } from "react";
import { Badge, Button, ButtonLink, Modal, SelectField, TextField } from "@hawkcode/ui";

type Invite = {
  id: string;
  token: string;
  role: string;
  email?: string | null;
  expiresAt: string;
  acceptedAt?: string | null;
};

const DEFAULT_URL = "http://localhost:3001";

export default function AdminPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteDays, setInviteDays] = useState("7");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteListError, setInviteListError] = useState<string | null>(null);
  const [inviteActionMessage, setInviteActionMessage] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteFilter, setInviteFilter] = useState("all");
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email?: string | null } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    if (!serverUrl) return;
    async function fetchMe() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/me`, {
          method: "GET",
          credentials: "include"
        });
        if (!response.ok) {
          window.location.href = "/login";
          return;
        }
        await fetchInvites();
      } catch {
        window.location.href = "/login";
      }
    }
    void fetchMe();
  }, [serverUrl]);

  async function fetchInvites() {
    setInviteListError(null);
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setInviteListError(body.error ?? "Failed to load invites.");
        return;
      }
      const body = await response.json();
      setInvites(body.invites ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load invites.";
      setInviteListError(message);
    }
  }

  async function handleCreateInvite() {
    setInviteError(null);
    setInviteLink(null);
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: inviteEmail || undefined,
          role: inviteRole,
          expiresInDays: Number(inviteDays) || 7
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setInviteError(body.error ?? "Invite creation failed.");
        return;
      }
      const body = await response.json();
      const token = body.token as string;
      const link = `${window.location.origin}/invite/${token}`;
      setInviteLink(link);
      await fetchInvites();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invite creation failed.";
      setInviteError(message);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setInviteActionMessage("Copied to clipboard.");
    } catch {
      setInviteActionMessage("Copy failed.");
    }
  }

  async function handleRevokeInvite(id: string) {
    setInviteActionMessage(null);
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites/${id}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setInviteActionMessage(body.error ?? "Failed to revoke invite.");
        return;
      }
      await fetchInvites();
      setRevokeTarget(null);
      setInviteActionMessage("Invite revoked.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to revoke invite.";
      setInviteActionMessage(message);
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

  return (
    <main className="simple-page">
      <header className="simple-header">
        <div>
          <Badge label="Admin" />
          <h1>Workspace admin</h1>
          <p>Manage invitations and workspace access.</p>
        </div>
        <div className="actions">
          <ButtonLink label="Back to sessions" href="/app" variant="outline" />
        </div>
      </header>

      <section className="simple-grid">
        <div className="card-shell">
          <h3>Create invite</h3>
          <p>Invite a teammate to your workspace.</p>
          <div className="stack">
            <TextField
              label="Invite email (optional)"
              value={inviteEmail}
              onChange={setInviteEmail}
            />
            <SelectField
              label="Role"
              value={inviteRole}
              onChange={setInviteRole}
              options={[
                { label: "Viewer", value: "viewer" },
                { label: "Maintainer", value: "maintainer" }
              ]}
            />
            <TextField
              label="Expires in days"
              value={inviteDays}
              onChange={setInviteDays}
              helpText="1 to 30 days"
            />
            <div className="actions">
              <Button label="Create invite" onClick={handleCreateInvite} />
            </div>
            {inviteLink ? (
              <span className="time">Invite link: {inviteLink}</span>
            ) : null}
            {inviteError ? <span className="error">{inviteError}</span> : null}
          </div>
        </div>

        <div className="card-shell">
          <h3>My invites</h3>
          <p>Manage active invites.</p>
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
            {inviteActionMessage ? <span className="time">{inviteActionMessage}</span> : null}
            {inviteListError ? <span className="error">{inviteListError}</span> : null}
            {filteredInvites.length === 0 ? (
              <span className="time">No invites yet.</span>
            ) : (
              <div className="invite-list">
                {filteredInvites.map((invite) => {
                  const link = `${window.location.origin}/invite/${invite.token}`;
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
                        <span className="time">{link}</span>
                        <div className="actions">
                          <Button label="Copy" variant="outline" onClick={() => handleCopy(link)} />
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
        </div>
      </section>

      <Modal
        open={Boolean(revokeTarget)}
        title="Revoke invite"
        description="This will invalidate the invite immediately."
        onClose={() => setRevokeTarget(null)}
      >
        <div className="stack">
          <span className="time">{revokeTarget?.email ?? "No email"}</span>
          <div className="actions">
            <Button label="Cancel" variant="outline" onClick={() => setRevokeTarget(null)} />
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

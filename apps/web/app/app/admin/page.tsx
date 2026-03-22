"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, ButtonLink, Modal, SelectField, TextField } from "@hawkcode/ui";

type Invite = {
  id: string;
  token: string;
  role: string;
  email?: string | null;
  expiresAt: string;
  acceptedAt?: string | null;
};

type WorkspaceRecord = {
  id: string;
  name: string;
};

type GitHubUserRecord = {
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  scope?: string | null;
  connectedAt: string;
};

type WorkspaceGithubRepo = {
  id: string;
  provider: string;
  repoUrl: string;
  repoName: string;
  projectId: string;
  projectName: string;
  githubInstallId?: string | null;
  connectedAt: string;
};

type AvailableGitHubRepo = {
  name: string;
  fullName: string;
  repoUrl: string;
  private: boolean;
  ownerLogin: string;
};

type WorkspaceGithubState = {
  authConfigured: boolean;
  connected: boolean;
  user: GitHubUserRecord | null;
  canManage: boolean;
  repos: WorkspaceGithubRepo[];
  availableRepos: AvailableGitHubRepo[];
};

type WorkspaceTreeResponse = {
  workspaces?: Array<{ id: string; name: string }>;
};

type WorkspaceGithubResponse = {
  github?: WorkspaceGithubState;
};

type GitHubDeviceStartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: string;
};

type GitHubDevicePollResponse = {
  status?: "pending" | "slow_down" | "connected" | "error";
  message?: string;
  error?: string;
  intervalSeconds?: number;
  github?: {
    authConfigured: boolean;
    connected: boolean;
    user: GitHubUserRecord | null;
  };
};

type GitHubAuthState = {
  inProgress: boolean;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresAt?: string;
  statusText?: string;
  error?: string;
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
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceGithub, setWorkspaceGithub] = useState<WorkspaceGithubState | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isConnectingRepo, setIsConnectingRepo] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [selectedRepoUrl, setSelectedRepoUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [githubAuth, setGithubAuth] = useState<GitHubAuthState>({
    inProgress: false
  });

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null;
  const filteredAvailableRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    const repos = workspaceGithub?.availableRepos ?? [];
    if (!query) {
      return repos;
    }

    return repos.filter((repo) => {
      return (
        repo.fullName.toLowerCase().includes(query) ||
        repo.repoUrl.toLowerCase().includes(query)
      );
    });
  }, [repoQuery, workspaceGithub?.availableRepos]);

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    if (!serverUrl) return;

    async function fetchData() {
      try {
        const authResponse = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/me`, {
          method: "GET",
          credentials: "include"
        });
        if (!authResponse.ok) {
          window.location.href = "/login";
          return;
        }

        await Promise.all([fetchInvites(), fetchWorkspaces()]);
      } catch {
        window.location.href = "/login";
      }
    }

    void fetchData();
  }, [serverUrl]);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceGithub(null);
      return;
    }

    void loadWorkspaceGithub(selectedWorkspaceId);
  }, [selectedWorkspaceId, serverUrl]);

  useEffect(() => {
    setRepoQuery("");
    setSelectedRepoUrl("");
    setProjectName("");
    setGithubError(null);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!githubAuth.inProgress || !githubAuth.deviceCode) {
      return;
    }

    let cancelled = false;
    let nextIntervalSeconds = Math.max(5, githubAuth.intervalSeconds ?? 5);
    let timer: number | undefined;

    function scheduleNextPoll() {
      if (cancelled) {
        return;
      }

      timer = window.setTimeout(() => {
        void pollGitHubAuth();
      }, nextIntervalSeconds * 1000);
    }

    async function pollGitHubAuth() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/github/device/poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            deviceCode: githubAuth.deviceCode
          })
        });

        const data = (await response.json().catch(() => null)) as GitHubDevicePollResponse | null;
        if (cancelled) {
          return;
        }

        if (response.ok && (data?.status === "pending" || data?.status === "slow_down")) {
          if (data.status === "slow_down") {
            nextIntervalSeconds += Math.max(5, data.intervalSeconds ?? 5);
          } else if (data.intervalSeconds) {
            nextIntervalSeconds = Math.max(5, data.intervalSeconds);
          }

          setGithubAuth((current) =>
            current.inProgress
              ? {
                  ...current,
                  intervalSeconds: nextIntervalSeconds,
                  statusText: data.message ?? "Waiting for GitHub approval..."
                }
              : current
          );
          scheduleNextPoll();
          return;
        }

        if (response.ok && data?.status === "connected") {
          setGithubAuth({
            inProgress: false,
            statusText: data.github?.user?.login
              ? `Connected as ${data.github.user.login}.`
              : "GitHub connected."
          });
          if (selectedWorkspaceId) {
            await loadWorkspaceGithub(selectedWorkspaceId);
          }
          return;
        }

        setGithubAuth({
          inProgress: false,
          error: data?.message ?? data?.error ?? "GitHub authentication failed."
        });
      } catch (error) {
        if (!cancelled) {
          setGithubAuth({
            inProgress: false,
            error: error instanceof Error ? error.message : "GitHub authentication failed."
          });
        }
      }
    }

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [githubAuth.deviceCode, githubAuth.inProgress, githubAuth.intervalSeconds, selectedWorkspaceId, serverUrl]);

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

  async function fetchWorkspaces() {
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/tree`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Failed to load workspaces.");
      }

      const body = (await response.json()) as WorkspaceTreeResponse;
      setWorkspaces(body.workspaces ?? []);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Failed to load workspaces.");
    }
  }

  async function loadWorkspaceGithub(workspaceId: string) {
    setIsLoadingGithub(true);
    setGithubError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/${workspaceId}/github`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Failed to load GitHub workspace settings.");
      }

      const body = (await response.json()) as WorkspaceGithubResponse;
      setWorkspaceGithub(
        body.github ?? {
          authConfigured: false,
          connected: false,
          user: null,
          canManage: false,
          repos: [],
          availableRepos: []
        }
      );
    } catch (error) {
      setWorkspaceGithub(null);
      setGithubError(error instanceof Error ? error.message : "Failed to load GitHub workspace settings.");
    } finally {
      setIsLoadingGithub(false);
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

  async function handleStartGitHubAuth() {
    setGithubError(null);
    setGithubAuth({
      inProgress: false
    });

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/github/device/start`, {
        method: "POST",
        credentials: "include"
      });

      const data = (await response.json().catch(() => null)) as
        | (GitHubDeviceStartResponse & { error?: string })
        | null;
      if (!response.ok || !data?.deviceCode || !data.userCode || !data.verificationUri) {
        throw new Error(data?.error ?? "Could not start GitHub authentication.");
      }

      setGithubAuth({
        inProgress: true,
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        intervalSeconds: data.intervalSeconds,
        expiresAt: data.expiresAt,
        statusText: "Open GitHub in your browser and enter the code."
      });
      window.open(data.verificationUri, "_blank", "noopener,noreferrer");
    } catch (error) {
      setGithubAuth({
        inProgress: false,
        error: error instanceof Error ? error.message : "Could not start GitHub authentication."
      });
    }
  }

  async function handleDisconnectGitHub() {
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/github`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Could not disconnect GitHub.");
      }

      setGithubAuth({
        inProgress: false,
        statusText: "GitHub disconnected."
      });
      if (selectedWorkspaceId) {
        await loadWorkspaceGithub(selectedWorkspaceId);
      }
    } catch (error) {
      setGithubAuth({
        inProgress: false,
        error: error instanceof Error ? error.message : "Could not disconnect GitHub."
      });
    }
  }

  async function handleConnectRepo() {
    if (!selectedWorkspaceId || !selectedRepoUrl || !workspaceGithub?.connected) {
      return;
    }

    setIsConnectingRepo(true);
    setGithubError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/workspaces/${selectedWorkspaceId}/github/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            repoUrl: selectedRepoUrl,
            ...(projectName.trim() ? { projectName: projectName.trim() } : {})
          })
        }
      );

      const data = (await response.json().catch(() => null)) as
        | { message?: string; error?: string; syncError?: string | null }
        | null;
      if (!response.ok) {
        throw new Error(data?.message ?? data?.error ?? "Could not connect GitHub repo.");
      }

      if (selectedWorkspaceId) {
        await loadWorkspaceGithub(selectedWorkspaceId);
      }
      setRepoQuery("");
      setSelectedRepoUrl("");
      setProjectName("");
      setInviteActionMessage(
        data?.syncError
          ? `Repo connected, but initial server sync failed: ${data.syncError}`
          : "Repo connected to the workspace."
      );
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Could not connect GitHub repo.");
    } finally {
      setIsConnectingRepo(false);
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
          <p>Manage invitations, GitHub access, and workspace repos.</p>
        </div>
        <div className="actions">
          <ButtonLink label="Back to sessions" href="/app" variant="outline" />
        </div>
      </header>

      <section className="simple-grid">
        <div className="card-shell">
          <h3>GitHub repos</h3>
          <p>Owners can connect a GitHub repo to the selected workspace.</p>
          <div className="stack">
            <SelectField
              label="Workspace"
              value={selectedWorkspaceId}
              onChange={setSelectedWorkspaceId}
              options={
                workspaces.length > 0
                  ? workspaces.map((workspace) => ({
                      label: workspace.name,
                      value: workspace.id
                    }))
                  : [{ label: "No workspaces", value: "" }]
              }
            />
            <span className="time">
              {isLoadingGithub
                ? "Loading GitHub access..."
                : workspaceGithub?.connected
                  ? `Connected as @${workspaceGithub.user?.login ?? "github"}`
                  : workspaceGithub?.authConfigured
                    ? "GitHub account not connected"
                    : "GitHub OAuth is not configured"}
            </span>
            {workspaceGithub?.authConfigured ? (
              <div className="actions">
                <Button
                  label={
                    githubAuth.inProgress
                      ? "Waiting for GitHub..."
                      : workspaceGithub.connected
                        ? "Reconnect GitHub"
                        : "Connect GitHub"
                  }
                  variant="outline"
                  onClick={handleStartGitHubAuth}
                />
                {workspaceGithub.connected ? (
                  <Button label="Disconnect" variant="outline" onClick={handleDisconnectGitHub} />
                ) : null}
              </div>
            ) : null}
            {githubAuth.userCode ? (
              <span className="time">
                Device code {githubAuth.userCode}
                {githubAuth.statusText ? ` · ${githubAuth.statusText}` : ""}
              </span>
            ) : null}
            {selectedWorkspace && workspaceGithub && !workspaceGithub.canManage ? (
              <span className="time">
                Repo selection is owner-only for {selectedWorkspace.name}.
              </span>
            ) : null}
            {workspaceGithub?.canManage ? (
              <>
                <TextField
                  label="Filter repos"
                  value={repoQuery}
                  onChange={setRepoQuery}
                  placeholder="Search by owner/repo"
                />
                <SelectField
                  label="GitHub repo"
                  value={selectedRepoUrl}
                  onChange={(value) => {
                    setSelectedRepoUrl(value);
                    const selectedRepo = (workspaceGithub?.availableRepos ?? []).find(
                      (repo) => repo.repoUrl === value
                    );
                    setProjectName(selectedRepo?.name ?? "");
                  }}
                  options={
                    filteredAvailableRepos.length > 0
                      ? [
                          { label: "Select a repo", value: "" },
                          ...filteredAvailableRepos.map((repo) => ({
                            label: `${repo.fullName}${repo.private ? " (private)" : ""}`,
                            value: repo.repoUrl
                          }))
                        ]
                      : [{ label: "No repos found", value: "" }]
                  }
                  helpText="Repos are loaded from the connected GitHub account."
                />
                <TextField
                  label="Workspace project name"
                  value={projectName}
                  onChange={setProjectName}
                  placeholder="Defaults to the repo name"
                />
                <div className="actions">
                  <Button
                    label={isConnectingRepo ? "Connecting repo..." : "Connect repo"}
                    onClick={handleConnectRepo}
                  />
                  <Button
                    label="Refresh repo list"
                    variant="outline"
                    onClick={() => selectedWorkspaceId && void loadWorkspaceGithub(selectedWorkspaceId)}
                  />
                </div>
              </>
            ) : null}
            {workspaceGithub?.repos.length ? (
              <div className="invite-list">
                {workspaceGithub.repos.map((repo) => (
                  <div key={repo.id} className="invite-row">
                    <div className="invite-main">
                      <span>{repo.repoName}</span>
                      <span className="time">{repo.projectName}</span>
                    </div>
                    <span className="time">{repo.repoUrl}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="time">No GitHub repos connected to this workspace yet.</span>
            )}
            {githubError ? <span className="error">{githubError}</span> : null}
            {githubAuth.error ? <span className="error">{githubAuth.error}</span> : null}
          </div>
        </div>

        <div className="card-shell">
          <h3>Create invite</h3>
          <p>Invite a teammate to your workspace.</p>
          <div className="stack">
            <TextField label="Invite email (optional)" value={inviteEmail} onChange={setInviteEmail} />
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
            {inviteLink ? <span className="time">Invite link: {inviteLink}</span> : null}
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

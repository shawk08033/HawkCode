"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type User = {
  id: string;
  email: string;
};

type ProviderInfo = {
  name: "codex" | "openrouter";
  label: string;
  defaultModel: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type SessionRecord = {
  id: string;
  serverSessionId?: string;
  title: string;
  projectId?: string | null;
  projectName?: string | null;
  updated: string;
  model: string;
  branch: string;
  status: string;
  contextCount: number;
  worktree?: {
    path: string;
    branch: string;
    createdAt: string;
  } | null;
  messages: ChatMessage[];
};

type WorkspaceRecord = {
  id: string;
  name: string;
  sessions: SessionRecord[];
  schedules: Array<{ id: string; title: string }>;
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

type GitHubUserRecord = {
  login: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  scope?: string | null;
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

type AgentReplyResponse = {
  sessionId: string;
  agentRunId: string;
  provider: "codex" | "openrouter";
  model: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
    createdAt: string;
  };
};

type WorkspaceTreeResponse = {
  workspaces?: WorkspaceRecord[];
};

type WorkspaceGithubResponse = {
  github?: WorkspaceGithubState;
};

type WorkspaceGitLocalState = {
  path: string | null;
  branch: string | null;
  lastSyncedAt: string | null;
  clean: boolean | null;
  changedFiles: number | null;
  stagedFiles: number | null;
  modifiedFiles: number | null;
  deletedFiles: number | null;
  untrackedFiles: number | null;
  ahead: number | null;
  behind: number | null;
  error: string | null;
  lastCommit: {
    sha: string;
    shortSha: string;
    subject: string;
    committedAt: string;
  } | null;
  status: "ready" | "missing" | "error";
};

type WorkspaceGitRepo = WorkspaceGithubRepo & {
  serverSync: WorkspaceGitLocalState;
};

type WorkspaceGitState = {
  checkoutRoot: string;
  canManage: boolean;
  repos: WorkspaceGitRepo[];
};

type WorkspaceGitResponse = {
  git?: WorkspaceGitState;
};

type SessionFileEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number | null;
};

type SessionFileContext = {
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  currentPath: string;
  worktree: {
    id: string;
    path: string;
    branch: string;
    createdAt: string;
  } | null;
  entries: SessionFileEntry[];
  file: {
    path: string;
    content: string;
    truncated: boolean;
    size: number;
  } | null;
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

function formatTimestamp(value?: string) {
  if (!value) {
    return "Now";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Now";
  }

  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function preferProvider(providers: ProviderInfo[]) {
  return providers.find((provider) => provider.name === "codex") ?? providers[0] ?? null;
}

export default function AppHome() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [draft, setDraft] = useState("");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceRecord[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<"codex" | "openrouter" | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [workspaceGithub, setWorkspaceGithub] = useState<WorkspaceGithubState | null>(null);
  const [workspaceGit, setWorkspaceGit] = useState<WorkspaceGitState | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isLoadingGit, setIsLoadingGit] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [githubAuth, setGithubAuth] = useState<GitHubAuthState>({
    inProgress: false
  });
  const [sessionFiles, setSessionFiles] = useState<SessionFileContext | null>(null);

  const allSessions = useMemo(
    () => workspaceTree.flatMap((workspace) => workspace.sessions),
    [workspaceTree]
  );
  const selectedSession = useMemo(
    () => allSessions.find((session) => session.id === selectedSessionId) ?? null,
    [allSessions, selectedSessionId]
  );
  const selectedWorkspace = useMemo(
    () => {
      const explicitWorkspace =
        workspaceTree.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
      if (explicitWorkspace) {
        return explicitWorkspace;
      }

      return (
        workspaceTree.find((workspace) =>
          workspace.sessions.some((session) => session.id === selectedSessionId)
        ) ?? workspaceTree[0]
      );
    },
    [selectedSessionId, selectedWorkspaceId, workspaceTree]
  );
  const syncedRepos = useMemo(
    () => workspaceGit?.repos.filter((repo) => repo.serverSync.status === "ready") ?? [],
    [workspaceGit]
  );
  const recentActivity = useMemo(() => {
    const events: Array<{ id: string; label: string }> = [];

    if (selectedSession) {
      events.push({
        id: `session-${selectedSession.id}`,
        label: `${selectedSession.updated} · Session ${selectedSession.title}`
      });
    }

    for (const repo of workspaceGit?.repos ?? []) {
      if (repo.serverSync.lastSyncedAt) {
        events.push({
          id: `repo-${repo.id}`,
          label: `${formatTimestamp(repo.serverSync.lastSyncedAt)} · ${repo.projectName} synced to server`
        });
      }
    }

    return events.slice(0, 4);
  }, [selectedSession, workspaceGit]);
  const activeProvider =
    providers.find((provider) => provider.name === selectedProvider) ??
    preferProvider(providers);
  const selectedProjectRepo =
    syncedRepos.find((repo) => repo.projectId === selectedSession?.projectId) ?? null;

  async function loadWorkspaceGithub(workspaceId: string) {
    setIsLoadingGithub(true);
    setGithubError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/${workspaceId}/github`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Could not load GitHub workspace settings.");
      }

      const data = (await response.json()) as WorkspaceGithubResponse;
      setWorkspaceGithub(
        data.github ?? {
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
      setGithubError(error instanceof Error ? error.message : "Could not load GitHub workspace settings.");
    } finally {
      setIsLoadingGithub(false);
    }
  }

  async function loadWorkspaceGit(workspaceId: string) {
    setIsLoadingGit(true);
    setGitError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/${workspaceId}/git`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Could not load Git workspace status.");
      }

      const data = (await response.json()) as WorkspaceGitResponse;
      setWorkspaceGit(
        data.git ?? {
          checkoutRoot: "",
          canManage: false,
          repos: []
        }
      );
    } catch (error) {
      setWorkspaceGit(null);
      setGitError(error instanceof Error ? error.message : "Could not load Git workspace status.");
    } finally {
      setIsLoadingGit(false);
    }
  }

  async function loadSessionFiles(sessionId: string, currentPath = "") {
    setIsLoadingFiles(true);
    setFileError(null);

    try {
      const query = currentPath ? `?path=${encodeURIComponent(currentPath)}` : "";
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/sessions/${sessionId}/files${query}`,
        {
          method: "GET",
          credentials: "include"
        }
      );
      if (!response.ok) {
        throw new Error("Could not load session files.");
      }

      const data = (await response.json()) as { context?: SessionFileContext };
      setSessionFiles(data.context ?? null);
    } catch (error) {
      setSessionFiles(null);
      setFileError(error instanceof Error ? error.message : "Could not load session files.");
    } finally {
      setIsLoadingFiles(false);
    }
  }

  async function loadSessionFile(sessionId: string, filePath: string) {
    setIsLoadingFiles(true);
    setFileError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`,
        {
          method: "GET",
          credentials: "include"
        }
      );
      if (!response.ok) {
        throw new Error("Could not load file.");
      }

      const data = (await response.json()) as { context?: SessionFileContext };
      setSessionFiles(data.context ?? null);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not load file.");
    } finally {
      setIsLoadingFiles(false);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hawkcode.workspaceTree");
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        setExpanded(parsed);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("hawkcode.workspaceTree", JSON.stringify(expanded));
    } catch {
      return;
    }
  }, [expanded]);

  useEffect(() => {
    if (workspaceTree.length === 0 || Object.keys(expanded).length > 0) {
      return;
    }

    setExpanded({
      [workspaceTree[0].id]: true
    });
  }, [expanded, workspaceTree]);

  useEffect(() => {
    if (!selectedWorkspaceId && workspaceTree.length > 0) {
      setSelectedWorkspaceId(workspaceTree[0].id);
    }
    if (
      selectedWorkspaceId &&
      !workspaceTree.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(workspaceTree[0]?.id ?? null);
    }
  }, [selectedWorkspaceId, workspaceTree]);

  useEffect(() => {
    if (!selectedSessionId && allSessions.length > 0) {
      setSelectedSessionId(allSessions[0].id);
    }
    if (selectedSessionId && !allSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(allSessions[0]?.id ?? null);
    }
  }, [selectedSessionId, allSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const parentWorkspace = workspaceTree.find((workspace) =>
      workspace.sessions.some((session) => session.id === selectedSessionId)
    );
    if (parentWorkspace) {
      setSelectedWorkspaceId(parentWorkspace.id);
    }
  }, [selectedSessionId, workspaceTree]);

  useEffect(() => {
    setDraft("");
    setSendError(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSession?.serverSessionId) {
      setSessionFiles(null);
      setFileError(null);
      return;
    }

    if (!selectedSession.worktree) {
      setSessionFiles(null);
      setFileError(null);
      return;
    }

    void loadSessionFiles(selectedSession.serverSessionId);
  }, [selectedSession?.serverSessionId, selectedSession?.worktree?.path]);

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
        const data = await response.json();
        setUser(data.user);
        await checkAdmin();
      } catch {
        window.location.href = "/login";
      }
    }

    async function checkAdmin() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/invites`, {
          method: "GET",
          credentials: "include"
        });
        setIsAdmin(response.ok);
      } catch {
        setIsAdmin(false);
      }
    }

    void fetchMe();
  }, [serverUrl]);

  useEffect(() => {
    if (!user) {
      setProviders([]);
      setSelectedProvider(null);
      return;
    }

    async function loadProviders() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/providers`, {
          method: "GET",
          credentials: "include"
        });
        if (!response.ok) {
          setProviders([]);
          setSelectedProvider(null);
          return;
        }
        const data = (await response.json()) as { providers?: ProviderInfo[] };
        const nextProviders = data.providers ?? [];
        setProviders(nextProviders);
        setSelectedProvider((current) => {
          if (current && nextProviders.some((provider) => provider.name === current)) {
            return current;
          }
          return preferProvider(nextProviders)?.name ?? null;
        });
      } catch {
        setProviders([]);
        setSelectedProvider(null);
      }
    }

    void loadProviders();
  }, [serverUrl, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    async function loadWorkspaceTree() {
      setWorkspaceTree([]);
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/tree`, {
          method: "GET",
          credentials: "include"
        });
        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as WorkspaceTreeResponse;
        const nextTree =
          data.workspaces?.map((workspace) => ({
            ...workspace,
            sessions: workspace.sessions.map((session) => ({
              ...session,
              serverSessionId: session.id
            }))
          })) ?? [];

        setWorkspaceTree(nextTree);
      } catch {
        return;
      }
    }

    void loadWorkspaceTree();
  }, [serverUrl, user]);

  useEffect(() => {
    setGithubError(null);
    setGitError(null);
    setGithubAuth({
      inProgress: false
    });
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (!user || !selectedWorkspace?.id) {
      setWorkspaceGithub(null);
      setIsLoadingGithub(false);
      setGithubError(null);
      return;
    }

    void loadWorkspaceGithub(selectedWorkspace.id);
  }, [serverUrl, user, selectedWorkspace?.id]);

  useEffect(() => {
    if (!user || !selectedWorkspace?.id) {
      setWorkspaceGit(null);
      setIsLoadingGit(false);
      setGitError(null);
      return;
    }

    void loadWorkspaceGit(selectedWorkspace.id);
  }, [serverUrl, user, selectedWorkspace?.id]);

  async function handleLogout() {
    await fetch(`${serverUrl.replace(/\/$/, "")}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
    window.location.href = "/login";
  }

  function toggleWorkspace(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSelectWorkspace(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    setExpanded((prev) => ({ ...prev, [workspaceId]: true }));
  }

  async function handleCreateSession() {
    const workspaceId = selectedWorkspace?.id ?? workspaceTree[0]?.id;
    if (!workspaceId) {
      return;
    }

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          workspaceId,
          title: "New session"
        })
      });

      if (!response.ok) {
        throw new Error("Could not create session.");
      }

      const data = (await response.json()) as { session: SessionRecord };
      const nextSession = {
        ...data.session,
        serverSessionId: data.session.id
      };

      setWorkspaceTree((current) =>
        current.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                sessions: [nextSession, ...workspace.sessions]
              }
            : workspace
        )
      );
      setSelectedSessionId(nextSession.id);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not create session.");
    }
  }

  function applyReplyToSession(localSessionId: string, userPrompt: string, response: AgentReplyResponse) {
    setWorkspaceTree((current) =>
      current.map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.map((session) => {
          if (session.id !== localSessionId) {
            return session;
          }

          const nextMessages: ChatMessage[] = [
            ...session.messages,
            {
              id: `user-${Date.now()}`,
              role: "user",
              content: userPrompt,
              timestamp: formatTimestamp()
            },
            {
              id: response.message.id,
              role: "assistant",
              content: response.message.content,
              timestamp: formatTimestamp(response.message.createdAt)
            }
          ];

          return {
            ...session,
            serverSessionId: response.sessionId,
            model: activeProvider?.label ?? session.model,
            updated: "Just now",
            status: "Live",
            messages: nextMessages
          };
        })
      }))
    );
  }

  async function handleSend() {
    if (!selectedSession || !draft.trim() || !activeProvider) {
      return;
    }

    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: activeProvider.name,
          model: activeProvider.defaultModel,
          sessionId: selectedSession.serverSessionId,
          message: draft.trim()
        })
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(errorBody?.message ?? errorBody?.error ?? "Agent request failed.");
      }

      const result = (await response.json()) as AgentReplyResponse;
      applyReplyToSession(selectedSession.id, draft.trim(), result);
      setDraft("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Agent request failed.");
    } finally {
      setIsSending(false);
    }
  }

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
          if (selectedWorkspace?.id) {
            await loadWorkspaceGithub(selectedWorkspace.id);
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
  }, [
    githubAuth.deviceCode,
    githubAuth.inProgress,
    githubAuth.intervalSeconds,
    selectedWorkspace?.id,
    serverUrl
  ]);

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
      if (selectedWorkspace?.id) {
        await loadWorkspaceGithub(selectedWorkspace.id);
      }
    } catch (error) {
      setGithubAuth({
        inProgress: false,
        error: error instanceof Error ? error.message : "Could not disconnect GitHub."
      });
    }
  }

  async function handleSyncProject(projectId: string) {
    if (!selectedWorkspace?.id) {
      return;
    }

    setIsLoadingGit(true);
    setGitError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/workspaces/${selectedWorkspace.id}/projects/${projectId}/sync`,
        {
          method: "POST",
          credentials: "include"
        }
      );

      const data = (await response.json().catch(() => null)) as
        | { repo?: WorkspaceGitRepo; message?: string; error?: string }
        | null;
      if (!response.ok || !data?.repo) {
        throw new Error(data?.message ?? data?.error ?? "Could not sync server checkout.");
      }

      setWorkspaceGit((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          repos: current.repos.map((repo) => (repo.projectId === projectId ? data.repo! : repo))
        };
      });
    } catch (error) {
      setGitError(error instanceof Error ? error.message : "Could not sync server checkout.");
    } finally {
      setIsLoadingGit(false);
    }
  }

  async function handleAssignSessionProject(projectId: string) {
    if (!selectedSession?.serverSessionId) {
      return;
    }

    setFileError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/project`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId
          })
        }
      );
      if (!response.ok) {
        throw new Error("Could not attach project to session.");
      }

      const data = (await response.json()) as { session: SessionRecord };
      setWorkspaceTree((current) =>
        current.map((workspace) => ({
          ...workspace,
          sessions: workspace.sessions.map((session) =>
            session.id === selectedSession.id
              ? {
                  ...session,
                  ...data.session,
                  serverSessionId: data.session.id
                }
              : session
          )
        }))
      );
      setSessionFiles(null);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not attach project.");
    }
  }

  async function handleCreateSessionWorktree() {
    if (!selectedSession?.serverSessionId || !selectedSession.projectId) {
      return;
    }

    setIsCreatingWorktree(true);
    setFileError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/worktree`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            projectId: selectedSession.projectId
          })
        }
      );
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(errorBody?.message ?? errorBody?.error ?? "Could not create session worktree.");
      }

      await Promise.all([
        selectedWorkspace?.id ? loadWorkspaceGit(selectedWorkspace.id) : Promise.resolve(),
        fetch(`${serverUrl.replace(/\/$/, "")}/workspaces/tree`, {
          method: "GET",
          credentials: "include"
        })
          .then(async (treeResponse) => {
            if (!treeResponse.ok) {
              return;
            }

            const data = (await treeResponse.json()) as WorkspaceTreeResponse;
            const nextTree =
              data.workspaces?.map((workspace) => ({
                ...workspace,
                sessions: workspace.sessions.map((session) => ({
                  ...session,
                  serverSessionId: session.id
                }))
              })) ?? [];

            setWorkspaceTree(nextTree);
          })
      ]);

      await loadSessionFiles(selectedSession.serverSessionId);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not create session worktree.");
    } finally {
      setIsCreatingWorktree(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[240px_1fr_300px]">
        <aside className="flex h-full flex-col border-r border-border bg-card px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">HawkCode</div>
            <div className="text-[11px] text-muted-foreground">{user?.email ?? "Loading..."}</div>
          </div>
          <Separator className="my-3" />
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Workspaces
              </div>
              <Button size="sm" variant="ghost">
                New
              </Button>
            </div>
            {workspaceTree.map((workspace) => (
              <div key={workspace.id} className="space-y-2">
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm ${
                    selectedWorkspace?.id === workspace.id ? "bg-accent" : ""
                  }`}
                  onClick={() => {
                    handleSelectWorkspace(workspace.id);
                    toggleWorkspace(workspace.id);
                  }}
                  aria-expanded={expanded[workspace.id]}
                >
                  <span className={`transition-transform ${expanded[workspace.id] ? "rotate-90" : ""}`}>
                    ▸
                  </span>
                  <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
                  <span className="font-medium">{workspace.name}</span>
                </button>
                {expanded[workspace.id] ? (
                  <div className="space-y-2 pl-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      Sessions
                    </div>
                    <div className="space-y-1">
                      {workspace.sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => {
                            setSelectedSessionId(session.id);
                            setSelectedWorkspaceId(workspace.id);
                          }}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                            selectedSessionId === session.id
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background/40 hover:bg-accent"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{session.title}</span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                              {session.status}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {session.updated} • {session.model}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      Schedules
                    </div>
                    <div className="space-y-1">
                      {workspace.schedules.length > 0 ? (
                        workspace.schedules.map((schedule) => (
                          <div
                            key={schedule.id}
                            className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-muted-foreground"
                          >
                            {schedule.title}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-border bg-background/20 px-3 py-2 text-xs text-muted-foreground">
                          No schedules yet.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="pt-3">
            <Button size="sm" variant="outline" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        <main className="flex min-h-screen flex-col">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>{selectedWorkspace?.name ?? "Workspace"}</Badge>
                  {selectedSession ? (
                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      {selectedSession.status}
                    </span>
                  ) : null}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold">
                    {selectedSession?.title ?? "Select a session"}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedSession
                      ? `Server-backed AI chat for ${selectedSession.model} on ${selectedSession.branch}.`
                      : "Choose a session or workspace to manage server-side automation."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <Button size="sm" variant="outline" onClick={() => (window.location.href = "/app/admin")}>
                    Admin
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => (window.location.href = "/app/settings")}>
                  Settings
                </Button>
                <Button size="sm" onClick={handleCreateSession}>
                  New session
                </Button>
              </div>
            </div>
            {selectedSession ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Provider {activeProvider?.label ?? "Unavailable"}
                </div>
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Branch {selectedSession.branch}
                </div>
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  {selectedSession.contextCount} context items
                </div>
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Updated {selectedSession.updated}
                </div>
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  {syncedRepos.length} server checkouts ready
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {selectedSession ? (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {selectedSession.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-3xl rounded-3xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card"
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] opacity-70">
                        <span>{message.role === "user" ? "You" : "Assistant"}</span>
                        <span>{message.timestamp}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                    </div>
                  </div>
                ))}
                {isSending ? (
                  <div className="flex justify-start">
                    <div className="max-w-3xl rounded-3xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                      Thinking with {activeProvider?.label ?? "agent"}...
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
                <Card className="w-full border-dashed bg-card/50">
                  <CardHeader>
                    <CardTitle>{selectedWorkspace ? `No session selected in ${selectedWorkspace.name}` : "Pick a workspace session"}</CardTitle>
                    <CardDescription>
                      {selectedWorkspace
                        ? "You can still connect repos and sync server files from the tools panel."
                        : "The main panel turns into a normal AI conversation once a session is selected."}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            )}
          </div>

          <div className="border-t border-border px-6 py-4">
            <div className="mx-auto max-w-4xl space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDraft("Summarize the current branch and propose the next implementation step.")}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  Summarize branch
                </button>
                <button
                  type="button"
                  onClick={() => setDraft("Review the latest changes and list the highest-risk regressions.")}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  Review latest changes
                </button>
                <button
                  type="button"
                  onClick={() => setDraft("Draft a plan for the next UI milestone in this workspace.")}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  Plan next milestone
                </button>
              </div>
              <div className="rounded-3xl border border-border bg-card p-3 shadow-sm">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Message HawkCode about this session..."
                  className="min-h-28 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {providers.length > 0
                      ? `Using ${activeProvider?.label ?? "agent"} for this reply.`
                      : "No agent providers available yet."}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedProvider ?? ""}
                      onChange={(event) =>
                        setSelectedProvider(event.target.value as "codex" | "openrouter")
                      }
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                      disabled={providers.length === 0 || isSending}
                    >
                      {providers.length === 0 ? <option value="">No providers</option> : null}
                      {providers.map((provider) => (
                        <option key={provider.name} value={provider.name}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline">
                      Attach
                    </Button>
                    <Button
                      size="sm"
                      disabled={!selectedSession || !draft.trim() || !activeProvider || isSending}
                      onClick={handleSend}
                    >
                      {isSending ? "Sending..." : "Send"}
                    </Button>
                  </div>
                </div>
                {sendError ? <div className="mt-3 text-xs text-destructive">{sendError}</div> : null}
              </div>
            </div>
          </div>
        </main>

        <aside className="border-l border-border px-4 py-4">
          <Tabs defaultValue="context">
            <TabsList>
              <TabsTrigger value="context">Context</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="integrations">Tools</TabsTrigger>
            </TabsList>
            <TabsContent value="context">
              <div className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Desktop Workflow</CardTitle>
                    <CardDescription>
                      {selectedSession
                        ? "Session file browsing and worktree actions now live in the desktop app."
                        : "Select a session to view desktop workflow guidance."}
                    </CardDescription>
                  </CardHeader>
                  {selectedSession ? (
                    <CardContent className="space-y-3 text-xs text-muted-foreground">
                      <div className="rounded-lg border border-border px-3 py-2">
                        Use the desktop app for:
                        <div className="mt-2">Attach a synced repo to the session</div>
                        <div>Create or reset a session worktree</div>
                        <div>Browse and preview synced files</div>
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2">
                        Use this web portal for workspace administration, GitHub repo management, and server sync status.
                      </div>
                    </CardContent>
                  ) : null}
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Session settings</CardTitle>
                    <CardDescription>Model, branch, and automation settings.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span>Provider</span>
                      <span>{activeProvider?.label ?? "None"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span>Branch</span>
                      <span>{selectedSession?.branch ?? "None"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span>Status</span>
                      <span>{selectedSession?.status ?? "Idle"}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="activity">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent activity</CardTitle>
                    <CardDescription>Latest server-backed work in this workspace.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-muted-foreground">
                    {recentActivity.length > 0 ? (
                      recentActivity.map((event) => (
                        <div key={event.id} className="rounded-lg border border-border px-3 py-2">
                          {event.label}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2">
                        No recent server activity yet.
                      </div>
                    )}
                  </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="integrations">
              <div className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle>GitHub</CardTitle>
                    <CardDescription>Connect your GitHub account, then attach workspace repos.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span>GitHub account</span>
                        <span>
                          {isLoadingGithub
                            ? "Loading..."
                            : workspaceGithub?.connected
                              ? `@${workspaceGithub.user?.login ?? "connected"}`
                              : workspaceGithub?.authConfigured
                                ? "Not connected"
                                : "OAuth not configured"}
                        </span>
                      </div>
                    </div>
                    {!isLoadingGithub && workspaceGithub && !workspaceGithub.authConfigured ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Add `githubClientId` to `hawkcode.config.json` and restart the server to enable GitHub sign-in.
                      </div>
                    ) : null}
                    {workspaceGithub?.connected && workspaceGithub.user ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">
                          {workspaceGithub.user.name ?? workspaceGithub.user.login}
                        </div>
                        <div className="mt-1">@{workspaceGithub.user.login}</div>
                        {workspaceGithub.user.scope ? (
                          <div className="mt-1">Scopes: {workspaceGithub.user.scope}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {githubAuth.userCode ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">Device code</div>
                        <div className="mt-1 font-mono text-sm tracking-[0.2em]">{githubAuth.userCode}</div>
                        {githubAuth.statusText ? <div className="mt-2">{githubAuth.statusText}</div> : null}
                        {githubAuth.expiresAt ? (
                          <div className="mt-1">
                            Expires {new Date(githubAuth.expiresAt).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit"
                            })}
                          </div>
                        ) : null}
                        {githubAuth.verificationUri ? (
                          <button
                            type="button"
                            className="mt-2 text-primary underline underline-offset-4"
                            onClick={() =>
                              window.open(githubAuth.verificationUri, "_blank", "noopener,noreferrer")
                            }
                          >
                            Open GitHub verification page
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {githubAuth.error ? (
                      <div className="text-xs text-destructive">{githubAuth.error}</div>
                    ) : null}
                    {workspaceGithub?.authConfigured ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 justify-center"
                          onClick={handleStartGitHubAuth}
                          disabled={githubAuth.inProgress}
                        >
                          {githubAuth.inProgress
                            ? "Waiting for GitHub..."
                            : workspaceGithub.connected
                              ? "Reconnect GitHub"
                              : "Connect GitHub"}
                        </Button>
                        {workspaceGithub.connected ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 justify-center"
                            onClick={handleDisconnectGitHub}
                            disabled={githubAuth.inProgress}
                          >
                            Disconnect
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {isLoadingGithub ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Loading connected repos...
                      </div>
                    ) : workspaceGithub?.repos.length ? (
                      <div className="space-y-2">
                        {workspaceGithub.repos.map((repo) => (
                          <div
                            key={repo.id}
                            className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium text-foreground">{repo.repoName}</span>
                              <span>{repo.projectName}</span>
                            </div>
                            <a
                              href={repo.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block truncate text-primary underline underline-offset-4"
                            >
                              {repo.repoUrl}
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No GitHub repos connected for this workspace yet.
                      </div>
                    )}
                    {githubError ? (
                      <div className="text-xs text-destructive">{githubError}</div>
                    ) : null}
                    {workspaceGithub?.canManage ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Manage workspace repos from the Admin page. Repo selection is restricted to workspace owners.
                      </div>
                    ) : workspaceGithub && !isLoadingGithub ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Repo selection is admin-only. Ask the workspace owner to manage connected repos.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Server checkouts</CardTitle>
                    <CardDescription>
                      Repositories synced onto the HawkCode server so schedules can run without the desktop app.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {workspaceGit?.checkoutRoot ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Checkout root: {workspaceGit.checkoutRoot}
                      </div>
                    ) : null}
                    {isLoadingGit ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Loading server checkout status...
                      </div>
                    ) : workspaceGit?.repos.length ? (
                      <div className="space-y-2">
                        {workspaceGit.repos.map((repo) => (
                          <div
                            key={repo.id}
                            className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium text-foreground">{repo.repoName}</span>
                              <span>
                                {repo.serverSync.status === "ready"
                                  ? "Synced"
                                  : repo.serverSync.status === "error"
                                    ? "Needs attention"
                                    : "Not synced"}
                              </span>
                            </div>
                            <a
                              href={repo.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block truncate text-primary underline underline-offset-4"
                            >
                              {repo.repoUrl}
                            </a>
                            {repo.serverSync.status === "ready" ? (
                              <div className="mt-2 space-y-1">
                                <div>
                                  Branch `{repo.serverSync.branch}` ·{" "}
                                  {repo.serverSync.clean ? "Clean" : "Dirty"}
                                  {repo.serverSync.ahead || repo.serverSync.behind
                                    ? ` · ahead ${repo.serverSync.ahead} / behind ${repo.serverSync.behind}`
                                    : ""}
                                </div>
                                <div>
                                  {repo.serverSync.changedFiles} changed · {repo.serverSync.stagedFiles} staged ·{" "}
                                  {repo.serverSync.modifiedFiles} modified ·{" "}
                                  {repo.serverSync.untrackedFiles} untracked
                                </div>
                                <div className="truncate">Path: {repo.serverSync.path}</div>
                                {repo.serverSync.lastSyncedAt ? (
                                  <div>Last synced {formatTimestamp(repo.serverSync.lastSyncedAt)}</div>
                                ) : null}
                                {repo.serverSync.lastCommit ? (
                                  <div>
                                    Last commit {repo.serverSync.lastCommit.shortSha} ·{" "}
                                    {repo.serverSync.lastCommit.subject}
                                  </div>
                                ) : null}
                              </div>
                            ) : repo.serverSync.status === "error" ? (
                              <div className="mt-2 space-y-1 text-destructive">
                                <div>Server checkout is unavailable.</div>
                                {repo.serverSync.path ? (
                                  <div className="truncate text-xs text-muted-foreground">
                                    Expected path: {repo.serverSync.path}
                                  </div>
                                ) : null}
                                {repo.serverSync.error ? (
                                  <div className="text-xs">{repo.serverSync.error}</div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-muted-foreground">
                                This repo is connected, but the server has not pulled files yet.
                              </div>
                            )}
                            {workspaceGit?.canManage ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-3 w-full justify-center"
                                onClick={() => handleSyncProject(repo.projectId)}
                                disabled={isLoadingGit}
                              >
                                {repo.serverSync.status === "ready" ? "Sync latest to server" : "Sync repo to server"}
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No repos connected for this workspace yet.
                      </div>
                    )}
                    {gitError ? <div className="text-xs text-destructive">{gitError}</div> : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-center"
                      onClick={() => selectedWorkspace?.id && void loadWorkspaceGit(selectedWorkspace.id)}
                      disabled={isLoadingGit || !selectedWorkspace?.id}
                    >
                      {isLoadingGit ? "Refreshing..." : "Refresh server status"}
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Server tools</CardTitle>
                    <CardDescription>Workspace automation lives on the server now.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button size="sm" variant="outline" className="w-full justify-start">
                      Attach files
                    </Button>
                    <Button size="sm" variant="outline" className="w-full justify-start">
                      Run checks
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

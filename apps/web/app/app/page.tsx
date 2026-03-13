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
  updated: string;
  model: string;
  branch: string;
  status: string;
  contextCount: number;
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

type WorkspaceGithubState = {
  authConfigured: boolean;
  connected: boolean;
  user: GitHubUserRecord | null;
  canManage: boolean;
  repos: WorkspaceGithubRepo[];
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
  path: string;
  branch: string;
  clean: boolean;
  changedFiles: number;
  stagedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  untrackedFiles: number;
  ahead: number;
  behind: number;
  lastCommit: {
    sha: string;
    shortSha: string;
    subject: string;
    committedAt: string;
  };
};

type WorkspaceGitRepo = WorkspaceGithubRepo & {
  local: WorkspaceGitLocalState | null;
};

type WorkspaceGitState = {
  detected: boolean;
  localRepoUrl: string | null;
  localPath: string | null;
  repos: WorkspaceGitRepo[];
};

type WorkspaceGitResponse = {
  git?: WorkspaceGitState;
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

function createInitialWorkspaces(): WorkspaceRecord[] {
  return [
    {
      id: "ws-1",
      name: "HawkCode",
      sessions: [
        {
          id: "sess-1",
          title: "Auth + invites",
          updated: "2m ago",
          model: "Codex",
          branch: "feature/desktop-chat-ui",
          status: "Live",
          contextCount: 6,
          messages: [
            {
              id: "m-1",
              role: "user",
              content:
                "Review the invite acceptance flow and tell me where the workspace UI still feels rough.",
              timestamp: "9:14 AM"
            },
            {
              id: "m-2",
              role: "assistant",
              content:
                "The biggest gap is that session state, context, and actions are split across views. Pulling them into a standard chat layout makes the workflow easier to understand.",
              timestamp: "9:15 AM"
            }
          ]
        },
        {
          id: "sess-2",
          title: "Desktop onboarding",
          updated: "40m ago",
          model: "OpenRouter",
          branch: "desktop-app-init",
          status: "Waiting",
          contextCount: 4,
          messages: [
            {
              id: "m-5",
              role: "user",
              content: "Draft a cleaner first-run experience for connecting a workstation to HawkCode.",
              timestamp: "8:36 AM"
            },
            {
              id: "m-6",
              role: "assistant",
              content:
                "Use a short connection stepper: server URL, trust decision, sign-in, then workspace selection. That keeps the flow understandable and reduces dead-end states.",
              timestamp: "8:37 AM"
            }
          ]
        }
      ],
      schedules: [
        { id: "sch-1", title: "Nightly test run" },
        { id: "sch-2", title: "Morning standup summary" }
      ]
    },
    {
      id: "ws-2",
      name: "Internal Tools",
      sessions: [
        {
          id: "sess-3",
          title: "Cron runner",
          updated: "1d ago",
          model: "Codex",
          branch: "main",
          status: "Idle",
          contextCount: 3,
          messages: [
            {
              id: "m-7",
              role: "user",
              content: "Map out how scheduled prompts should surface run history and failures.",
              timestamp: "Yesterday"
            },
            {
              id: "m-8",
              role: "assistant",
              content:
                "Show the last run status directly in the workspace tree, then keep full logs and retry actions in a side panel so the main view stays focused on the conversation.",
              timestamp: "Yesterday"
            }
          ]
        }
      ],
      schedules: [{ id: "sch-3", title: "Dependency audit" }]
    }
  ];
}

function isPlaceholderWorkspaceId(workspaceId?: string | null) {
  return Boolean(workspaceId && /^ws-\d+$/.test(workspaceId));
}

function preferProvider(providers: ProviderInfo[]) {
  return providers.find((provider) => provider.name === "codex") ?? providers[0] ?? null;
}

export default function AppHome() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [draft, setDraft] = useState("");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceRecord[]>(createInitialWorkspaces);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "ws-1": true,
    "ws-2": false
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<"codex" | "openrouter" | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [workspaceGithub, setWorkspaceGithub] = useState<WorkspaceGithubState | null>(null);
  const [workspaceGit, setWorkspaceGit] = useState<WorkspaceGitState | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isLoadingGit, setIsLoadingGit] = useState(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubProjectName, setGithubProjectName] = useState("");
  const [githubAuth, setGithubAuth] = useState<GitHubAuthState>({
    inProgress: false
  });

  const allSessions = useMemo(
    () => workspaceTree.flatMap((workspace) => workspace.sessions),
    [workspaceTree]
  );
  const selectedSession = useMemo(
    () => allSessions.find((session) => session.id === selectedSessionId) ?? null,
    [allSessions, selectedSessionId]
  );
  const selectedWorkspace = useMemo(
    () =>
      workspaceTree.find((workspace) =>
        workspace.sessions.some((session) => session.id === selectedSessionId)
      ) ?? workspaceTree[0],
    [selectedSessionId, workspaceTree]
  );
  const activeProvider =
    providers.find((provider) => provider.name === selectedProvider) ??
    preferProvider(providers);

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
          repos: []
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
          detected: false,
          localRepoUrl: null,
          localPath: null,
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
    if (!selectedSessionId && allSessions.length > 0) {
      setSelectedSessionId(allSessions[0].id);
    }
    if (selectedSessionId && !allSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(allSessions[0]?.id ?? null);
    }
  }, [selectedSessionId, allSessions]);

  useEffect(() => {
    setDraft("");
    setSendError(null);
  }, [selectedSessionId]);

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
    setGithubRepoUrl("");
    setGithubProjectName("");
    setGithubError(null);
    setGitError(null);
    setGithubAuth({
      inProgress: false
    });
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (!user || !selectedWorkspace?.id || isPlaceholderWorkspaceId(selectedWorkspace.id)) {
      setWorkspaceGithub(null);
      setIsLoadingGithub(false);
      setGithubError(null);
      return;
    }

    void loadWorkspaceGithub(selectedWorkspace.id);
  }, [serverUrl, user, selectedWorkspace?.id]);

  useEffect(() => {
    if (!user || !selectedWorkspace?.id || isPlaceholderWorkspaceId(selectedWorkspace.id)) {
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

  async function handleConnectGithub() {
    if (!selectedWorkspace?.id || !githubRepoUrl.trim() || !workspaceGithub?.connected) {
      return;
    }

    setIsConnectingGithub(true);
    setGithubError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/workspaces/${selectedWorkspace.id}/github/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            repoUrl: githubRepoUrl.trim(),
            ...(githubProjectName.trim() ? { projectName: githubProjectName.trim() } : {})
          })
        }
      );

      const data = (await response.json().catch(() => null)) as
        | { repo?: WorkspaceGithubRepo; message?: string; error?: string }
        | null;
      if (!response.ok || !data?.repo) {
        throw new Error(data?.message ?? data?.error ?? "Could not connect GitHub repo.");
      }

      const repo = data.repo;
      setWorkspaceGithub((current) => {
        const nextRepos = [...(current?.repos ?? [])];
        const existingIndex = nextRepos.findIndex((currentRepo) => currentRepo.id === repo.id);
        if (existingIndex >= 0) {
          nextRepos[existingIndex] = repo;
        } else {
          nextRepos.unshift(repo);
        }

        return {
          authConfigured: current?.authConfigured ?? false,
          connected: current?.connected ?? true,
          user: current?.user ?? null,
          canManage: current?.canManage ?? true,
          repos: nextRepos
        };
      });
      setGithubRepoUrl("");
      setGithubProjectName("");
      await loadWorkspaceGit(selectedWorkspace.id);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Could not connect GitHub repo.");
    } finally {
      setIsConnectingGithub(false);
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
                  className="flex w-full items-center gap-2 text-left text-sm"
                  onClick={() => toggleWorkspace(workspace.id)}
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
                          onClick={() => setSelectedSessionId(session.id)}
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
                      {workspace.schedules.map((schedule) => (
                        <div
                          key={schedule.id}
                          className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-muted-foreground"
                        >
                          {schedule.title}
                        </div>
                      ))}
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
                      ? `Standard AI chat for ${selectedSession.model} on ${selectedSession.branch}.`
                      : "Choose a session from the left to continue the thread."}
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
                    <CardTitle>Pick a workspace session</CardTitle>
                    <CardDescription>
                      The main panel turns into a normal AI conversation once a session is selected.
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
                    <CardTitle>Session context</CardTitle>
                    <CardDescription>
                      {selectedSession
                        ? `${selectedSession.contextCount} items attached to this conversation.`
                        : "Select a session to inspect its context bundle."}
                    </CardDescription>
                  </CardHeader>
                  {selectedSession ? (
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      <div className="rounded-lg border border-border px-3 py-2">
                        `apps/web/app/app/page.tsx`
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2">
                        `apps/server/src/routes/agents.ts`
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2">
                        `packages/agent/src/index.ts`
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
                  <CardDescription>Latest work on the selected session.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs text-muted-foreground">
                  <div className="rounded-lg border border-border px-3 py-2">
                    2m ago · Session state synced to workspace server
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    11m ago · Context bundle updated with auth routes
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2">
                    42m ago · Web workspace shell refreshed
                  </div>
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
                      <div className="space-y-2">
                        <input
                          value={githubRepoUrl}
                          onChange={(event) => setGithubRepoUrl(event.target.value)}
                          placeholder="https://github.com/owner/repo"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <input
                          value={githubProjectName}
                          onChange={(event) => setGithubProjectName(event.target.value)}
                          placeholder="Project name (optional)"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full justify-center"
                          onClick={handleConnectGithub}
                          disabled={
                            isConnectingGithub ||
                            !githubRepoUrl.trim() ||
                            !workspaceGithub.connected ||
                            githubAuth.inProgress
                          }
                        >
                          {isConnectingGithub ? "Connecting..." : "Connect repo"}
                        </Button>
                      </div>
                    ) : workspaceGithub && !isLoadingGithub ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Viewer access only. Ask an owner or maintainer to connect a repo.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Git</CardTitle>
                    <CardDescription>Local repo state for the workspace checkout on this machine.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isLoadingGit ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        Loading Git status...
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
                              <span>{repo.local ? "Local checkout matched" : "Remote only"}</span>
                            </div>
                            <a
                              href={repo.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block truncate text-primary underline underline-offset-4"
                            >
                              {repo.repoUrl}
                            </a>
                            {repo.local ? (
                              <div className="mt-2 space-y-1">
                                <div>
                                  Branch `{repo.local.branch}` · {repo.local.clean ? "Clean" : "Dirty"}
                                  {repo.local.ahead || repo.local.behind
                                    ? ` · ahead ${repo.local.ahead} / behind ${repo.local.behind}`
                                    : ""}
                                </div>
                                <div>
                                  {repo.local.changedFiles} changed · {repo.local.stagedFiles} staged ·{" "}
                                  {repo.local.modifiedFiles} modified · {repo.local.untrackedFiles} untracked
                                </div>
                                <div className="truncate">Path: {repo.local.path}</div>
                                <div>
                                  Last commit {repo.local.lastCommit.shortSha} · {repo.local.lastCommit.subject}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No Git repos connected for this workspace yet.
                      </div>
                    )}
                    {workspaceGit && !workspaceGit.detected ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No local Git checkout detected from the running server workspace.
                      </div>
                    ) : null}
                    {gitError ? <div className="text-xs text-destructive">{gitError}</div> : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-center"
                      onClick={() => selectedWorkspace?.id && void loadWorkspaceGit(selectedWorkspace.id)}
                      disabled={isLoadingGit || !selectedWorkspace?.id}
                    >
                      {isLoadingGit ? "Refreshing..." : "Refresh Git status"}
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Local tools</CardTitle>
                    <CardDescription>Shell, tests, and file context.</CardDescription>
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

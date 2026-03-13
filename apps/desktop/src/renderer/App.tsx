import { useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Badge } from "./components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { Separator } from "./components/ui/separator.js";

type Status = {
  state: "idle" | "checking" | "ok" | "error";
  message?: string;
  checkedAt?: string;
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

type CodexAuthStatus = {
  loggedIn: boolean;
  inProgress: boolean;
  authUrl?: string;
  code?: string;
  statusText?: string;
  error?: string;
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

type MessageSegment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language?: string };

const IS_DEV = !window.hawkcode?.version ? false : true;
const DEFAULT_URL = "https://localhost:3001";

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
          branch: "desktop-app-init",
          status: "Live",
          contextCount: 6,
          messages: [
            {
              id: "m-1",
              role: "user",
              content:
                "Review the invite acceptance flow and tell me where the desktop app is still brittle.",
              timestamp: "9:14 AM"
            },
            {
              id: "m-2",
              role: "assistant",
              content:
                "The login and invite path both depend on the same cookie behavior. The fragile area is still local TLS handling, especially when the desktop client talks to a self-signed server during setup.",
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
                "Use a short connection stepper: server URL, trust decision, sign-in, then workspace selection. That keeps the path understandable and reduces dead-end states.",
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
                "Show the last run status directly in the workspace tree, then keep full logs and retry actions in a side panel so the main session view stays focused on the conversation.",
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

function mergeProviders(serverProviders: ProviderInfo[], codexAuth: CodexAuthStatus) {
  if (!codexAuth.loggedIn) {
    return serverProviders;
  }

  const hasCodex = serverProviders.some((provider) => provider.name === "codex");
  if (hasCodex) {
    return serverProviders;
  }

  return [
    {
      name: "codex",
      label: "Codex",
      defaultModel: "gpt-5"
    } satisfies ProviderInfo,
    ...serverProviders
  ];
}

function getModelOptions(provider?: ProviderInfo | null) {
  if (!provider) {
    return [];
  }

  if (provider.name === "codex") {
    return ["gpt-5", "gpt-5-codex", "gpt-5-mini"];
  }

  return [
    provider.defaultModel,
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.5-pro"
  ].filter((value, index, all) => all.indexOf(value) === index);
}

function parseMessageContent(content: string): MessageSegment[] {
  const matches = [...content.matchAll(/```([\w.+-]*)\n?([\s\S]*?)```/g)];
  if (matches.length === 0) {
    return [{ type: "text", content }];
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({
        type: "text",
        content: content.slice(cursor, start)
      });
    }

    segments.push({
      type: "code",
      language: match[1] || undefined,
      content: match[2].replace(/\n$/, "")
    });
    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({
      type: "text",
      content: content.slice(cursor)
    });
  }

  return segments.filter((segment) => segment.content.length > 0);
}

function renderInlineContent(content: string, keyPrefix: string) {
  const pattern = /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/\S+)/g;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[0.9em]"
        >
          {match[1].slice(1, -1)}
        </code>
      );
    } else {
      const label = match[3] ?? match[0];
      const url = match[4] ?? match[5];
      nodes.push(
        <button
          key={`${keyPrefix}-link-${tokenIndex}`}
          type="button"
          className="text-left text-primary underline underline-offset-4"
          onClick={() => void window.hawkcode.openExternalUrl(url)}
        >
          {label}
        </button>
      );
    }

    lastIndex = pattern.lastIndex;
    tokenIndex += 1;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function renderTextSegment(content: string, keyPrefix: string) {
  const lines = content.split("\n");
  const blocks: JSX.Element[] = [];
  let index = 0;
  let blockIndex = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2];
      const className =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold uppercase tracking-[0.12em]";
      blocks.push(
        <div key={`${keyPrefix}-heading-${blockIndex}`} className={className}>
          {renderInlineContent(title, `${keyPrefix}-heading-inline-${blockIndex}`)}
        </div>
      );
      index += 1;
      blockIndex += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={`${keyPrefix}-quote-${blockIndex}`}
          className="border-l-2 border-border pl-4 text-muted-foreground"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`${keyPrefix}-quote-line-${quoteIndex}`} className="whitespace-pre-wrap text-sm leading-6">
              {renderInlineContent(quoteLine, `${keyPrefix}-quote-inline-${quoteIndex}`)}
            </p>
          ))}
        </blockquote>
      );
      blockIndex += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`${keyPrefix}-ul-${blockIndex}`} className="list-disc space-y-1 pl-5 text-sm leading-6">
          {items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ul-item-${itemIndex}`}>
              {renderInlineContent(item, `${keyPrefix}-ul-inline-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
      blockIndex += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`${keyPrefix}-ol-${blockIndex}`} className="list-decimal space-y-1 pl-5 text-sm leading-6">
          {items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ol-item-${itemIndex}`}>
              {renderInlineContent(item, `${keyPrefix}-ol-inline-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
      blockIndex += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (
        /^(#{1,3})\s+/.test(lines[index].trim()) ||
        /^>\s?/.test(lines[index].trim()) ||
        /^[-*]\s+/.test(lines[index].trim()) ||
        /^\d+\.\s+/.test(lines[index].trim())
      ) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = paragraphLines.join("\n");
    blocks.push(
      <p key={`${keyPrefix}-p-${blockIndex}`} className="whitespace-pre-wrap text-sm leading-6">
        {renderInlineContent(paragraph, `${keyPrefix}-p-inline-${blockIndex}`)}
      </p>
    );
    blockIndex += 1;
  }

  return blocks;
}

function renderMessageContent(
  content: string,
  messageId: string,
  copiedCodeId: string | null,
  onCopyCode: (codeId: string, code: string) => void
) {
  return parseMessageContent(content).map((segment, index) => {
    if (segment.type === "code") {
      const codeId = `${messageId}-code-${index}`;
      return (
        <div
          key={codeId}
          className="my-3 overflow-hidden rounded-2xl border border-border/70 bg-black/90 text-white"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">
              {segment.language ?? "Code"}
            </div>
            <button
              type="button"
              className="text-[10px] uppercase tracking-[0.2em] text-white/70 transition-colors hover:text-white"
              onClick={() => onCopyCode(codeId, segment.content)}
            >
              {copiedCodeId === codeId ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto px-4 py-3 text-xs leading-6">
            <code>{segment.content}</code>
          </pre>
        </div>
      );
    }

    return (
      <div key={`${messageId}-text-${index}`} className="space-y-3">
        {renderTextSegment(segment.content, `${messageId}-text-segment-${index}`)}
      </div>
    );
  });
}

export default function App() {
  const [serverUrl, setServerUrl] = useState("");
  const [serverConfigLoaded, setServerConfigLoaded] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceRecord[]>(createInitialWorkspaces);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "ws-1": true,
    "ws-2": false
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<"codex" | "openrouter" | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [serverProviders, setServerProviders] = useState<ProviderInfo[]>([]);
  const [codexAuth, setCodexAuth] = useState<CodexAuthStatus>({
    loggedIn: false,
    inProgress: false
  });
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
  const availableProviders = useMemo(
    () => mergeProviders(serverProviders, codexAuth),
    [serverProviders, codexAuth]
  );
  const activeProvider =
    availableProviders.find((provider) => provider.name === selectedProvider) ??
    preferProvider(availableProviders);
  const availableModels = useMemo(() => getModelOptions(activeProvider), [activeProvider]);

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
    window.hawkcode
      .getServerConfig()
      .then((config) => {
        setServerUrl(config.serverUrl || DEFAULT_URL);
      })
      .finally(() => {
        setServerConfigLoaded(true);
      });
  }, []);

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
    if (availableProviders.length === 0) {
      if (selectedProvider !== null) {
        setSelectedProvider(null);
      }
      return;
    }

    if (!selectedProvider || !availableProviders.some((provider) => provider.name === selectedProvider)) {
      setSelectedProvider(preferProvider(availableProviders)?.name ?? null);
    }
  }, [availableProviders, selectedProvider]);

  useEffect(() => {
    if (!activeProvider) {
      setSelectedModel("");
      return;
    }

    setSelectedModel((current) =>
      current && availableModels.includes(current) ? current : activeProvider.defaultModel
    );
  }, [activeProvider, availableModels]);

  useEffect(() => {
    if (!serverConfigLoaded || !serverUrl) {
      return;
    }

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

    void checkAuth();
  }, [serverConfigLoaded, serverUrl]);

  useEffect(() => {
    if (!serverConfigLoaded || !authUser) {
      setServerProviders([]);
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
          setServerProviders([]);
          setSelectedProvider(null);
          return;
        }
        const data = (await response.json()) as { providers?: ProviderInfo[] };
        const nextProviders = data.providers ?? [];
        setServerProviders(nextProviders);
        setSelectedProvider((current) => {
          const merged = mergeProviders(nextProviders, codexAuth);
          if (current && merged.some((provider) => provider.name === current)) {
            return current;
          }
          return preferProvider(merged)?.name ?? null;
        });
      } catch {
        setServerProviders([]);
        setSelectedProvider(null);
      }
    }

    void loadProviders();
  }, [authUser, codexAuth.loggedIn, serverConfigLoaded, serverUrl]);

  useEffect(() => {
    if (!serverConfigLoaded || !authUser) {
      setCodexAuth({
        loggedIn: false,
        inProgress: false
      });
      return;
    }

    async function loadCodexAuthStatus() {
      try {
        setCodexAuth(await window.hawkcode.getCodexAuthStatus());
      } catch {
        setCodexAuth({
          loggedIn: false,
          inProgress: false,
          error: "Could not check Codex login state."
        });
      }
    }

    void loadCodexAuthStatus();
  }, [authUser, serverConfigLoaded, serverUrl]);

  useEffect(() => {
    if (!codexAuth.inProgress) {
      return;
    }

    const interval = window.setInterval(() => {
      void window.hawkcode.getCodexAuthStatus().then(setCodexAuth).catch(() => undefined);
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [codexAuth.inProgress]);

  useEffect(() => {
    if (!serverConfigLoaded || !authUser) {
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
  }, [authUser, serverConfigLoaded, serverUrl]);

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
    if (
      !serverConfigLoaded ||
      !authUser ||
      !selectedWorkspace?.id ||
      isPlaceholderWorkspaceId(selectedWorkspace.id)
    ) {
      setWorkspaceGithub(null);
      setIsLoadingGithub(false);
      setGithubError(null);
      return;
    }

    void loadWorkspaceGithub(selectedWorkspace.id);
  }, [authUser, selectedWorkspace?.id, serverConfigLoaded, serverUrl]);

  useEffect(() => {
    if (
      !serverConfigLoaded ||
      !authUser ||
      !selectedWorkspace?.id ||
      isPlaceholderWorkspaceId(selectedWorkspace.id)
    ) {
      setWorkspaceGit(null);
      setIsLoadingGit(false);
      setGitError(null);
      return;
    }

    void loadWorkspaceGit(selectedWorkspace.id);
  }, [authUser, selectedWorkspace?.id, serverConfigLoaded, serverUrl]);

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
    const result = await window.hawkcode.checkHealth(serverUrl);
    if (result.ok) {
      await window.hawkcode.setServerUrl(serverUrl);
      setStatus({ state: "ok", checkedAt: result.checkedAt });
      return;
    }

    setStatus({
      state: "error",
      message: result.error ?? "Health check failed",
      checkedAt: result.checkedAt
    });
  }

  async function handleLogin() {
    setAuthMessage(null);
    if (serverUrl.startsWith("http://") && !IS_DEV) {
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

  async function handleLogout() {
    try {
      await fetch(`${serverUrl.replace(/\/$/, "")}/auth/logout`, {
        method: "POST",
        credentials: "include"
      });
    } finally {
      setAuthUser(null);
    }
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

  function appendOptimisticUserMessage(localSessionId: string, prompt: string) {
    const optimisticId = `optimistic-user-${Date.now()}`;

    setWorkspaceTree((current) =>
      current.map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.map((session) => {
          if (session.id !== localSessionId) {
            return session;
          }

          return {
            ...session,
            updated: "Just now",
            messages: [
              ...session.messages,
              {
                id: optimisticId,
                role: "user",
                content: prompt,
                timestamp: formatTimestamp()
              }
            ]
          };
        })
      }))
    );

    return optimisticId;
  }

  function removeOptimisticMessage(localSessionId: string, optimisticId: string) {
    setWorkspaceTree((current) =>
      current.map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.map((session) => {
          if (session.id !== localSessionId) {
            return session;
          }

          return {
            ...session,
            messages: session.messages.filter((message) => message.id !== optimisticId)
          };
        })
      }))
    );
  }

  function handleCopyCode(codeId: string, code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(codeId);
      window.setTimeout(() => {
        setCopiedCodeId((current) => (current === codeId ? null : current));
      }, 1500);
    });
  }

  async function handleSend() {
    if (!selectedSession || !draft.trim() || !activeProvider) {
      return;
    }

    const prompt = draft.trim();
    const optimisticId = appendOptimisticUserMessage(selectedSession.id, prompt);
    setIsSending(true);
    setSendError(null);
    setDraft("");

    try {
      if (activeProvider.name === "codex") {
        const localResult = await window.hawkcode.generateCodexReply({
          model: selectedModel || activeProvider.defaultModel,
          messages: [
            ...selectedSession.messages.map((message) => ({
              role: message.role,
              content: message.content
            })),
            {
              role: "user",
              content: prompt
            }
          ]
        });

        const commitResponse = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/reply/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            provider: localResult.provider,
            model: localResult.model,
            sessionId: selectedSession.serverSessionId,
            message: prompt,
            assistantContent: localResult.content
          })
        });

        if (!commitResponse.ok) {
          const errorBody = (await commitResponse.json().catch(() => null)) as
            | { message?: string; error?: string }
            | null;
          throw new Error(errorBody?.message ?? errorBody?.error ?? "Agent request failed.");
        }

        const committed = (await commitResponse.json()) as AgentReplyResponse;
        removeOptimisticMessage(selectedSession.id, optimisticId);
        applyReplyToSession(selectedSession.id, prompt, committed);
        return;
      }

      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: activeProvider.name,
          model: selectedModel || activeProvider.defaultModel,
          sessionId: selectedSession.serverSessionId,
          message: prompt
        })
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(errorBody?.message ?? errorBody?.error ?? "Agent request failed.");
      }

      const result = (await response.json()) as AgentReplyResponse;
      removeOptimisticMessage(selectedSession.id, optimisticId);
      applyReplyToSession(selectedSession.id, prompt, result);
    } catch (error) {
      removeOptimisticMessage(selectedSession.id, optimisticId);
      setDraft(prompt);
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
      await window.hawkcode.openExternalUrl(data.verificationUri);
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

  async function handleConnectCodex() {
    try {
      const nextStatus = await window.hawkcode.startCodexAuth();
      setCodexAuth(nextStatus);
    } catch (error) {
      setCodexAuth({
        loggedIn: false,
        inProgress: false,
        error: error instanceof Error ? error.message : "Could not start Codex login."
      });
    }
  }

  if (!authUser) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6 py-12">
          <Card className="w-full border-border bg-card/80">
            <CardHeader className="space-y-2">
              <Badge>Login</Badge>
              <CardTitle className="text-2xl">Sign in to HawkCode</CardTitle>
              <CardDescription>Invite-only access. Ask your admin for an invite.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Server URL
                </label>
                <input
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleCheck}>
                  {status.state === "checking" ? "Checking..." : "Test connection"}
                </Button>
                {status.message ? (
                  <span className="text-xs text-muted-foreground">{status.message}</span>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Email</label>
                <input
                  type="email"
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Password</label>
                <input
                  type="password"
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span
                  className={
                    authMessage?.includes("failed")
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {authMessage ?? " "}
                </span>
                <Button size="sm" onClick={handleLogin}>
                  Sign in
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-background text-foreground">
      <div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)_300px] overflow-hidden">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-card px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">HawkCode</div>
            <div className="text-[11px] text-muted-foreground">{authUser}</div>
          </div>
          <Separator className="my-3" />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
          <div className="mt-4 pt-3">
            <Button size="sm" variant="outline" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden">
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
                <Button size="sm" variant="outline">
                  Share
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

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            {selectedSession ? (
              <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-8">
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
                      <div className="space-y-3">
                        {renderMessageContent(
                          message.content,
                          message.id,
                          copiedCodeId,
                          handleCopyCode
                        )}
                      </div>
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
          {selectedSession ? (
            <div className="bg-gradient-to-t from-background via-background/95 to-background/0 px-6 pb-5 pt-4">
              <div className="mx-auto max-w-4xl space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft("Summarize the current branch and propose the next implementation step.")}
                    className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    Summarize branch
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft("Review the latest changes and list the highest-risk regressions.")}
                    className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    Review latest changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft("Draft a plan for the next UI milestone in this workspace.")}
                    className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    Plan next milestone
                  </button>
                </div>
                <div className="rounded-[28px] border border-border/60 bg-card/70 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (selectedSession && draft.trim() && activeProvider && !isSending) {
                          void handleSend();
                        }
                      }
                    }}
                    placeholder="Message HawkCode about this session..."
                    className="min-h-28 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {availableProviders.length > 0
                        ? `Using ${activeProvider?.label ?? "agent"}${selectedModel ? ` · ${selectedModel}` : ""} for this reply.`
                        : "No agent providers available yet."}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedProvider ?? ""}
                        onChange={(event) =>
                          setSelectedProvider(event.target.value as "codex" | "openrouter")
                        }
                        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                        disabled={availableProviders.length === 0 || isSending}
                      >
                        {availableProviders.length === 0 ? <option value="">No providers</option> : null}
                        {availableProviders.map((provider) => (
                          <option key={provider.name} value={provider.name}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        className="h-9 w-44 rounded-md border border-border bg-background px-3 text-sm"
                        disabled={!activeProvider || isSending}
                      >
                        {availableModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
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
          ) : null}
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-border px-4 py-4">
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
                        `apps/desktop/src/renderer/App.tsx`
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
                    42m ago · Desktop branch rebased onto `main`
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="integrations">
              <div className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Codex</CardTitle>
                    <CardDescription>
                      Connect this desktop client to your ChatGPT-backed Codex login.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                      Status: {codexAuth.loggedIn ? "Connected" : codexAuth.inProgress ? "Waiting for sign-in" : "Not connected"}
                    </div>
                    {codexAuth.statusText ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        {codexAuth.statusText}
                      </div>
                    ) : null}
                    {codexAuth.code ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Device code: {codexAuth.code}
                      </div>
                    ) : null}
                    {codexAuth.authUrl ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void window.hawkcode.openExternalUrl(codexAuth.authUrl!)}
                      >
                        Open auth URL
                      </Button>
                    ) : null}
                    {codexAuth.error ? (
                      <div className="text-xs text-destructive">{codexAuth.error}</div>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={handleConnectCodex}
                      disabled={codexAuth.inProgress}
                    >
                      {codexAuth.inProgress ? "Waiting for browser login..." : codexAuth.loggedIn ? "Reconnect Codex" : "Connect Codex"}
                    </Button>
                  </CardContent>
                </Card>
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => void window.hawkcode.openExternalUrl(githubAuth.verificationUri!)}
                          >
                            Open GitHub verification page
                          </Button>
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
                            <button
                              type="button"
                              className="mt-1 block truncate text-left text-primary underline underline-offset-4"
                              onClick={() => void window.hawkcode.openExternalUrl(repo.repoUrl)}
                            >
                              {repo.repoUrl}
                            </button>
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
                            <button
                              type="button"
                              className="mt-1 block truncate text-left text-primary underline underline-offset-4"
                              onClick={() => void window.hawkcode.openExternalUrl(repo.repoUrl)}
                            >
                              {repo.repoUrl}
                            </button>
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

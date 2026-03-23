import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  name: "codex" | "cursor" | "gemini" | "openrouter";
  label: string;
  defaultModel: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
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
  provider: "codex" | "cursor" | "gemini" | "openrouter";
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

type CursorCliStatus = {
  found: boolean;
  loggedIn: boolean;
  inProgress: boolean;
  command: string | null;
  authUrl?: string;
  statusText: string;
  error?: string;
};

type GeminiCliStatus = {
  found: boolean;
  loggedIn: boolean;
  command: string | null;
  email?: string;
  statusText: string;
  error?: string;
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
    diff?: {
      path: string;
      content: string;
      hasChanges: boolean;
    } | null;
  } | null;
};

type SessionGitState = {
  branch: string | null;
  baseBranch: string | null;
  repoUrl: string | null;
  clean: boolean;
  changedFiles: Array<{
    path: string;
    staged: boolean;
    modified: boolean;
    untracked: boolean;
  }>;
  ahead: number | null;
  behind: number | null;
  lastCommit: {
    sha: string;
    shortSha: string;
    subject: string;
    committedAt: string;
  } | null;
  canPush: boolean;
  canCreatePr: boolean;
};

type SessionGitResponse = {
  git?: SessionGitState;
  pullRequest?: {
    url: string;
    number: number;
    title: string;
    state: string;
  };
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

type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
  draftContent: string;
  truncated: boolean;
  size: number;
  diffContent: string;
  hasDiff: boolean;
  isEditing: boolean;
  isSaving: boolean;
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

function summarizeMessage(content: string, fallback = "No messages yet.") {
  const summary = content
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\s+/g, " ")
    .trim();

  if (!summary) {
    return fallback;
  }

  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
}

function getSessionPreview(session: SessionRecord) {
  const lastMessage = session.messages[session.messages.length - 1];
  if (!lastMessage) {
    return "No messages yet.";
  }

  const speaker =
    lastMessage.role === "user" ? "You" : lastMessage.role === "system" ? "Note" : "Assistant";
  return `${speaker}: ${summarizeMessage(lastMessage.content, "")}`;
}

function getMessageCountLabel(count: number) {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

function preferProvider(providers: ProviderInfo[]) {
  return providers.find((provider) => provider.name === "codex") ?? providers[0] ?? null;
}

function mergeProviders(serverProviders: ProviderInfo[], localProviders: ProviderInfo[]) {
  const merged = [...localProviders];
  for (const provider of serverProviders) {
    if (!merged.some((entry) => entry.name === provider.name)) {
      merged.push(provider);
    }
  }
  return merged;
}

function formatProviderRunLabel(provider: ProviderInfo, model: string) {
  return `${provider.label} · ${model}`;
}

function buildModelSwitchNote(nextRunLabel: string) {
  return `Model changed to ${nextRunLabel}.`;
}

function getModelSwitchNote(session: SessionRecord, provider: ProviderInfo, model: string) {
  const nextRunLabel = formatProviderRunLabel(provider, model);
  return session.model === nextRunLabel ? null : buildModelSwitchNote(nextRunLabel);
}

const CURSOR_SETUP_PROVIDER: ProviderInfo = {
  name: "cursor",
  label: "Cursor CLI (setup required)",
  defaultModel: "auto"
};

const GEMINI_SETUP_PROVIDER: ProviderInfo = {
  name: "gemini",
  label: "Gemini CLI (setup required)",
  defaultModel: "auto"
};

function getModelOptions(provider?: ProviderInfo | null) {
  if (!provider) {
    return [];
  }

  if (provider.name === "codex") {
    return ["gpt-5", "gpt-5-codex", "gpt-5-mini"];
  }

  if (provider.name === "cursor") {
    return [provider.defaultModel, "auto", "claude-4.6-opus-high-thinking", "gpt-5.4-medium", "gpt-5-mini"].filter(
      (value, index, all) => all.indexOf(value) === index
    );
  }

  if (provider.name === "gemini") {
    return [provider.defaultModel, "auto", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"].filter(
      (value, index, all) => all.indexOf(value) === index
    );
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
  const [selectedProvider, setSelectedProvider] = useState<"codex" | "cursor" | "gemini" | "openrouter" | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [serverProviders, setServerProviders] = useState<ProviderInfo[]>([]);
  const [localProviders, setLocalProviders] = useState<ProviderInfo[]>([]);
  const [codexAuth, setCodexAuth] = useState<CodexAuthStatus>({
    loggedIn: false,
    inProgress: false
  });
  const [geminiCli, setGeminiCli] = useState<GeminiCliStatus>({
    found: false,
    loggedIn: false,
    command: null,
    statusText: "Gemini CLI not found"
  });
  const [cursorCli, setCursorCli] = useState<CursorCliStatus>({
    found: false,
    loggedIn: false,
    inProgress: false,
    command: null,
    statusText: "Cursor CLI not found"
  });
  const [workspaceGithub, setWorkspaceGithub] = useState<WorkspaceGithubState | null>(null);
  const [workspaceGit, setWorkspaceGit] = useState<WorkspaceGitState | null>(null);
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [isLoadingGit, setIsLoadingGit] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sessionGit, setSessionGit] = useState<SessionGitState | null>(null);
  const [sessionGitError, setSessionGitError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pullRequestTitle, setPullRequestTitle] = useState("");
  const [pullRequestBody, setPullRequestBody] = useState("");
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isCreatingPullRequest, setIsCreatingPullRequest] = useState(false);
  const [githubRepoQuery, setGithubRepoQuery] = useState("");
  const [selectedGithubRepoUrl, setSelectedGithubRepoUrl] = useState("");
  const [githubProjectName, setGithubProjectName] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [githubAuth, setGithubAuth] = useState<GitHubAuthState>({
    inProgress: false
  });
  const [sessionFiles, setSessionFiles] = useState<SessionFileContext | null>(null);
  const [openEditorTabs, setOpenEditorTabs] = useState<EditorTab[]>([]);
  const [activeCenterTab, setActiveCenterTab] = useState<string>("chat");
  const [activeEditorView, setActiveEditorView] = useState<"source" | "diff">("source");
  const [selectedFileLineRange, setSelectedFileLineRange] = useState<{ start: number; end: number } | null>(
    null
  );
  const [lineSelectionAnchor, setLineSelectionAnchor] = useState<number | null>(null);
  const [isNearLatest, setIsNearLatest] = useState(true);
  const deferredSessionQuery = useDeferredValue(sessionQuery);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    () => mergeProviders(serverProviders, localProviders),
    [serverProviders, localProviders]
  );
  const filteredAvailableGithubRepos = useMemo(() => {
    const query = githubRepoQuery.trim().toLowerCase();
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
  }, [githubRepoQuery, workspaceGithub?.availableRepos]);
  const syncedRepos = useMemo(
    () => workspaceGit?.repos.filter((repo) => repo.serverSync.status === "ready") ?? [],
    [workspaceGit]
  );
  const filteredWorkspaces = useMemo(() => {
    const query = deferredSessionQuery.trim().toLowerCase();
    if (!query) {
      return workspaceTree;
    }

    return workspaceTree
      .map((workspace) => {
        const workspaceMatch = workspace.name.toLowerCase().includes(query);
        const sessions = workspace.sessions.filter((session) => {
          const haystack = [
            session.title,
            session.branch,
            session.model,
            session.status,
            ...session.messages.map((message) => message.content)
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(query);
        });

        const schedules = workspaceMatch
          ? workspace.schedules
          : workspace.schedules.filter((schedule) => schedule.title.toLowerCase().includes(query));

        if (workspaceMatch) {
          return workspace;
        }

        return {
          ...workspace,
          sessions,
          schedules
        };
      })
      .filter((workspace) => workspace.sessions.length > 0 || workspace.schedules.length > 0);
  }, [deferredSessionQuery, workspaceTree]);
  const activeProvider =
    availableProviders.find((provider) => provider.name === selectedProvider) ??
    preferProvider(availableProviders);
  const providerOptions = useMemo(() => {
    const options = [...availableProviders];
    if (!geminiCli.found && !options.some((provider) => provider.name === "gemini")) {
      options.push(GEMINI_SETUP_PROVIDER);
    }
    if (!cursorCli.found && !options.some((provider) => provider.name === "cursor")) {
      options.push(CURSOR_SETUP_PROVIDER);
    }
    return options;
  }, [availableProviders, cursorCli.found, geminiCli.found]);
  const geminiSetupSelected = selectedProvider === "gemini" && !geminiCli.found;
  const geminiLoginRequired = selectedProvider === "gemini" && geminiCli.found && !geminiCli.loggedIn;
  const cursorSetupSelected = selectedProvider === "cursor" && !cursorCli.found;
  const cursorLoginRequired = selectedProvider === "cursor" && cursorCli.found && !cursorCli.loggedIn;
  const availableModels = useMemo(() => getModelOptions(activeProvider), [activeProvider]);
  const selectedProjectRepo =
    syncedRepos.find((repo) => repo.projectId === selectedSession?.projectId) ?? null;
  const activeEditorTab = useMemo(
    () => openEditorTabs.find((tab) => tab.path === activeCenterTab) ?? null,
    [activeCenterTab, openEditorTabs]
  );
  const selectedFileLines = useMemo(() => {
    if (!activeEditorTab) {
      return [];
    }

    return (activeEditorTab.isEditing ? activeEditorTab.draftContent : activeEditorTab.content).split("\n");
  }, [activeEditorTab]);

  async function refreshAvailableProviders() {
    const [codexResult, geminiResult, cursorResult] = await Promise.allSettled([
      window.hawkcode.getCodexAuthStatus(),
      window.hawkcode.getGeminiCliStatus(),
      window.hawkcode.getCursorCliStatus()
    ]);

    const nextCodexAuth =
      codexResult.status === "fulfilled"
        ? codexResult.value
        : {
            loggedIn: false,
            inProgress: false,
            statusText: "Not connected",
            error: "Could not check Codex login state."
          } satisfies CodexAuthStatus;
    const nextCursorCli =
      cursorResult.status === "fulfilled"
        ? cursorResult.value
        : {
            found: false,
            loggedIn: false,
            inProgress: false,
            command: null,
            statusText: "Could not check Cursor CLI state.",
            error: "Could not check Cursor CLI state."
          } satisfies CursorCliStatus;
    const nextGeminiCli =
      geminiResult.status === "fulfilled"
        ? geminiResult.value
        : {
            found: false,
            loggedIn: false,
            command: null,
            statusText: "Could not check Gemini CLI state.",
            error: "Could not check Gemini CLI state."
          } satisfies GeminiCliStatus;

    setCodexAuth(nextCodexAuth);
    setGeminiCli(nextGeminiCli);
    setCursorCli(nextCursorCli);

    const nextLocalProviders: ProviderInfo[] = [
      ...(nextCodexAuth.loggedIn
        ? [{
            name: "codex",
            label: "Codex",
            defaultModel: "gpt-5"
          } satisfies ProviderInfo]
        : []),
      ...(nextGeminiCli.found
        ? [{
            name: "gemini",
            label: nextGeminiCli.loggedIn ? "Gemini CLI" : "Gemini CLI (login required)",
            defaultModel: "auto"
          } satisfies ProviderInfo]
        : []),
      ...(nextCursorCli.found
          ? [{
              name: "cursor",
              label: nextCursorCli.loggedIn ? "Cursor CLI" : "Cursor CLI (login required)",
              defaultModel: "auto"
            } satisfies ProviderInfo]
          : [])
    ];
    setLocalProviders(nextLocalProviders);

    let nextProviders: ProviderInfo[] = [];
    if (authUser) {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/agent/providers`, {
          method: "GET",
          credentials: "include"
        });
        nextProviders = response.ok
          ? (((await response.json()) as { providers?: ProviderInfo[] }).providers ?? [])
          : [];
      } catch {
        nextProviders = [];
      }
    }
    setServerProviders(nextProviders);
    setSelectedProvider((current) => {
      const merged = mergeProviders(nextProviders, nextLocalProviders);
      if (
        current &&
        (current === "cursor" || current === "gemini" || merged.some((provider) => provider.name === current))
      ) {
        return current;
      }
      return preferProvider(merged)?.name ?? null;
    });
  }

  async function loadSessionGit(sessionId: string) {
    setSessionGitError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions/${sessionId}/git`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error("Could not load session Git state.");
      }

      const data = (await response.json()) as SessionGitResponse;
      setSessionGit(data.git ?? null);
    } catch (error) {
      setSessionGit(null);
      setSessionGitError(error instanceof Error ? error.message : "Could not load session Git state.");
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
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions/${sessionId}/files${query}`, {
        method: "GET",
        credentials: "include"
      });
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
      const nextContext = data.context ?? null;
      setSessionFiles(nextContext);
      if (nextContext?.file) {
        const nextTab: EditorTab = {
          path: nextContext.file.path,
          content: nextContext.file.content,
          savedContent: nextContext.file.content,
          draftContent: nextContext.file.content,
          truncated: nextContext.file.truncated,
          size: nextContext.file.size
          ,
          diffContent: nextContext.file.diff?.content ?? "",
          hasDiff: nextContext.file.diff?.hasChanges ?? false,
          isEditing: false,
          isSaving: false
        };

        setOpenEditorTabs((current) => {
          const existingIndex = current.findIndex((tab) => tab.path === nextTab.path);
          if (existingIndex >= 0) {
            const nextTabs = [...current];
            nextTabs[existingIndex] = {
              ...nextTabs[existingIndex],
              ...nextTab,
              draftContent: nextTabs[existingIndex].isEditing
                ? nextTabs[existingIndex].draftContent
                : nextTab.draftContent,
              isEditing: nextTabs[existingIndex].isEditing,
              isSaving: false
            };
            return nextTabs;
          }

          return [...current, nextTab];
        });
        setActiveCenterTab(nextTab.path);
        setActiveEditorView("source");
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not load file.");
    } finally {
      setIsLoadingFiles(false);
    }
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
    setOpenEditorTabs([]);
    setActiveCenterTab("chat");
    setActiveEditorView("source");
    setSessionGit(null);
    setSessionGitError(null);
    setPullRequestUrl(null);
    setCommitMessage("");
    setPullRequestTitle("");
    setPullRequestBody("");
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSession?.serverSessionId || !selectedSession.worktree) {
      setSessionFiles(null);
      setFileError(null);
      setOpenEditorTabs([]);
      setActiveCenterTab("chat");
      setActiveEditorView("source");
      setSelectedFileLineRange(null);
      setLineSelectionAnchor(null);
      return;
    }

    void loadSessionFiles(selectedSession.serverSessionId);
  }, [selectedSession?.serverSessionId, selectedSession?.worktree?.path]);

  useEffect(() => {
    if (!selectedSession?.serverSessionId) {
      setSessionGit(null);
      setSessionGitError(null);
      return;
    }

    void loadSessionGit(selectedSession.serverSessionId);
  }, [selectedSession?.serverSessionId, selectedSession?.worktree?.path]);

  useEffect(() => {
    setSelectedFileLineRange(null);
    setLineSelectionAnchor(null);
  }, [activeEditorTab?.path]);

  useEffect(() => {
    if (activeCenterTab === "chat") {
      setActiveEditorView("source");
    }
  }, [activeCenterTab]);

  useEffect(() => {
    const textarea = draftTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [draft]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollTop = scroller.scrollHeight;
    setIsNearLatest(true);
  }, [selectedSessionId]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller || !selectedSession) {
      return;
    }

    if (isNearLatest) {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: isSending ? "smooth" : "auto"
      });
    }
  }, [isNearLatest, isSending, selectedSession?.messages.length]);

  function handleChatScroll() {
    const scroller = chatScrollRef.current;
    if (!scroller) {
      return;
    }

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setIsNearLatest(distanceFromBottom < 72);
  }

  function scrollChatToLatest() {
    const scroller = chatScrollRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "smooth"
    });
    setIsNearLatest(true);
  }

  useEffect(() => {
    if (providerOptions.length === 0) {
      if (selectedProvider !== null) {
        setSelectedProvider(null);
      }
      return;
    }

    if (!selectedProvider || !providerOptions.some((provider) => provider.name === selectedProvider)) {
      setSelectedProvider(preferProvider(availableProviders)?.name ?? null);
    }
  }, [availableProviders, providerOptions, selectedProvider]);

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
    if (!serverConfigLoaded) {
      return;
    }
    void refreshAvailableProviders();
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
    if (!cursorCli.inProgress) {
      return;
    }

    const interval = window.setInterval(() => {
      void window.hawkcode.getCursorCliStatus().then(setCursorCli).catch(() => undefined);
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [cursorCli.inProgress]);

  useEffect(() => {
    if (!serverConfigLoaded || !authUser) {
      return;
    }

    void loadWorkspaceTree();
  }, [authUser, serverConfigLoaded, serverUrl]);

  useEffect(() => {
    setGithubRepoQuery("");
    setSelectedGithubRepoUrl("");
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
          body: JSON.stringify({ projectId })
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
          body: JSON.stringify({ projectId: selectedSession.projectId })
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
        loadWorkspaceTree()
      ]);

      await loadSessionFiles(selectedSession.serverSessionId);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not create session worktree.");
    } finally {
      setIsCreatingWorktree(false);
    }
  }

  function handleSelectFileLine(lineNumber: number, extendSelection: boolean) {
    if (!extendSelection || lineSelectionAnchor === null) {
      setSelectedFileLineRange({ start: lineNumber, end: lineNumber });
      setLineSelectionAnchor(lineNumber);
      return;
    }

    setSelectedFileLineRange({
      start: Math.min(lineSelectionAnchor, lineNumber),
      end: Math.max(lineSelectionAnchor, lineNumber)
    });
  }

  function handleAddSelectionToChat() {
    if (!activeEditorTab || !selectedFileLineRange) {
      return;
    }

    const startIndex = Math.max(0, selectedFileLineRange.start - 1);
    const endIndex = Math.min(selectedFileLines.length, selectedFileLineRange.end);
    const snippet = selectedFileLines.slice(startIndex, endIndex).join("\n");
    const label =
      selectedFileLineRange.start === selectedFileLineRange.end
        ? `line ${selectedFileLineRange.start}`
        : `lines ${selectedFileLineRange.start}-${selectedFileLineRange.end}`;
    const nextSnippet = `Review ${activeEditorTab.path} ${label}:\n\`\`\`\n${snippet}\n\`\`\``;

    setDraft((current) => (current.trim() ? `${current.trim()}\n\n${nextSnippet}` : nextSnippet));
    draftTextareaRef.current?.focus();
  }

  function handleCloseEditorTab(path: string) {
    setOpenEditorTabs((current) => {
      const remainingTabs = current.filter((tab) => tab.path !== path);
      setActiveCenterTab((currentActiveTab) => {
        if (currentActiveTab !== path) {
          return currentActiveTab;
        }

        return remainingTabs[remainingTabs.length - 1]?.path ?? "chat";
      });
      return remainingTabs;
    });
  }

  function handleToggleEditorMode(isEditing: boolean) {
    if (!activeEditorTab) {
      return;
    }

    setOpenEditorTabs((current) =>
      current.map((tab) =>
        tab.path === activeEditorTab.path
          ? {
              ...tab,
              isEditing,
              draftContent: isEditing ? tab.draftContent : tab.savedContent
            }
          : tab
      )
    );
    if (isEditing) {
      setActiveEditorView("source");
    }
  }

  function handleEditorDraftChange(nextValue: string) {
    if (!activeEditorTab) {
      return;
    }

    setOpenEditorTabs((current) =>
      current.map((tab) =>
        tab.path === activeEditorTab.path
          ? {
              ...tab,
              draftContent: nextValue
            }
          : tab
      )
    );
  }

  async function handleSaveEditorTab() {
    if (!selectedSession?.serverSessionId || !activeEditorTab) {
      return;
    }

    setFileError(null);
    setOpenEditorTabs((current) =>
      current.map((tab) =>
        tab.path === activeEditorTab.path
          ? {
              ...tab,
              isSaving: true
            }
          : tab
      )
    );

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          path: activeEditorTab.path,
          content: activeEditorTab.draftContent
        })
      });
      if (!response.ok) {
        throw new Error("Could not save file.");
      }

      const data = (await response.json()) as { context?: SessionFileContext };
      const nextFile = data.context?.file;
      if (!nextFile) {
        throw new Error("Saved file response was incomplete.");
      }

      setSessionFiles(data.context ?? null);
      setOpenEditorTabs((current) =>
        current.map((tab) =>
          tab.path === nextFile.path
            ? {
                ...tab,
                content: nextFile.content,
                savedContent: nextFile.content,
                draftContent: nextFile.content,
                truncated: nextFile.truncated,
                size: nextFile.size,
                diffContent: nextFile.diff?.content ?? "",
                hasDiff: nextFile.diff?.hasChanges ?? false,
                isEditing: false,
                isSaving: false
              }
            : tab
        )
      );
      await loadSessionGit(selectedSession.serverSessionId);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not save file.");
      setOpenEditorTabs((current) =>
        current.map((tab) =>
          tab.path === activeEditorTab.path
            ? {
                ...tab,
                isSaving: false
              }
            : tab
        )
      );
    }
  }

  async function handleCommitSessionChanges() {
    if (!selectedSession?.serverSessionId || !commitMessage.trim()) {
      return;
    }

    setIsCommitting(true);
    setSessionGitError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: commitMessage.trim()
        })
      });
      const data = (await response.json().catch(() => null)) as
        | SessionGitResponse
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? "Could not commit changes.");
      }

      setSessionGit((data as SessionGitResponse).git ?? null);
      setCommitMessage("");
    } catch (error) {
      setSessionGitError(error instanceof Error ? error.message : "Could not commit changes.");
    } finally {
      setIsCommitting(false);
    }
  }

  async function handlePushSessionBranch() {
    if (!selectedSession?.serverSessionId) {
      return;
    }

    setIsPushing(true);
    setSessionGitError(null);

    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/push`, {
        method: "POST",
        credentials: "include"
      });
      const data = (await response.json().catch(() => null)) as
        | SessionGitResponse
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? "Could not push branch.");
      }

      setSessionGit((data as SessionGitResponse).git ?? null);
    } catch (error) {
      setSessionGitError(error instanceof Error ? error.message : "Could not push branch.");
    } finally {
      setIsPushing(false);
    }
  }

  async function handleCreatePullRequest() {
    if (!selectedSession?.serverSessionId) {
      return;
    }

    setIsCreatingPullRequest(true);
    setSessionGitError(null);

    try {
      const response = await fetch(
        `${serverUrl.replace(/\/$/, "")}/sessions/${selectedSession.serverSessionId}/pull-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: pullRequestTitle.trim() || undefined,
            body: pullRequestBody.trim() || undefined
          })
        }
      );
      const data = (await response.json().catch(() => null)) as
        | SessionGitResponse
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? "Could not create pull request.");
      }

      const next = data as SessionGitResponse;
      setSessionGit(next.git ?? null);
      setPullRequestUrl(next.pullRequest?.url ?? null);
      if (next.pullRequest?.url) {
        await window.hawkcode.openExternalUrl(next.pullRequest.url);
      }
    } catch (error) {
      setSessionGitError(error instanceof Error ? error.message : "Could not create pull request.");
    } finally {
      setIsCreatingPullRequest(false);
    }
  }

  function handleAskAiForSessionGit(kind: "commit" | "pr") {
    const changedFiles = sessionGit?.changedFiles.map((file) => file.path).slice(0, 50) ?? [];
    const changedList = changedFiles.length > 0 ? changedFiles.map((path) => `- ${path}`).join("\n") : "- No changed files detected";

    const prompt =
      kind === "commit"
        ? [
            "Write a concise commit message for the current session branch.",
            `Session: ${selectedSession?.title ?? "Unknown session"}`,
            `Branch: ${sessionGit?.branch ?? selectedSession?.worktree?.branch ?? "unknown"}`,
            "Changed files:",
            changedList,
            "",
            "Return only the commit message."
          ].join("\n")
        : [
            "Draft a pull request title and body for the current session branch.",
            `Session: ${selectedSession?.title ?? "Unknown session"}`,
            `Head branch: ${sessionGit?.branch ?? selectedSession?.worktree?.branch ?? "unknown"}`,
            `Base branch: ${sessionGit?.baseBranch ?? "main"}`,
            "Changed files:",
            changedList,
            "",
            "Format the response as:",
            "Title: ...",
            "",
            "Body:",
            "..."
          ].join("\n");

    setDraft(prompt);
    setActiveCenterTab("chat");
    draftTextareaRef.current?.focus();
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
            model:
              activeProvider && response.model
                ? formatProviderRunLabel(activeProvider, response.model)
                : session.model,
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

  function appendSessionNote(localSessionId: string, note: string) {
    const noteId = `system-note-${Date.now()}`;

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
                id: noteId,
                role: "system",
                content: note,
                timestamp: formatTimestamp()
              }
            ]
          };
        })
      }))
    );
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

  function buildLocalSelectionContextMessage() {
    if (!activeEditorTab || !selectedFileLineRange || activeEditorView === "diff") {
      return null;
    }

    const startIndex = Math.max(0, selectedFileLineRange.start - 1);
    const endIndex = Math.min(selectedFileLines.length, selectedFileLineRange.end);
    const snippet = selectedFileLines.slice(startIndex, endIndex).join("\n").trim();
    if (!snippet) {
      return null;
    }

    const label =
      selectedFileLineRange.start === selectedFileLineRange.end
        ? `line ${selectedFileLineRange.start}`
        : `lines ${selectedFileLineRange.start}-${selectedFileLineRange.end}`;

    return {
      role: "system" as const,
      content: [
        `Selected code context from ${activeEditorTab.path} ${label}:`,
        "```",
        snippet,
        "```"
      ].join("\n")
    };
  }

  function buildLocalProviderMessages(prompt: string) {
    const recentConversation = selectedSession
      ? selectedSession.messages
          .filter((message) => message.role !== "system")
          .slice(-8)
          .map((message) => ({
            role: message.role,
            content: message.content
          }))
      : [];
    const selectedContext = buildLocalSelectionContextMessage();

    return [
      ...recentConversation,
      ...(selectedContext ? [selectedContext] : []),
      {
        role: "user" as const,
        content: prompt
      }
    ];
  }

  async function handleSend() {
    if (!selectedSession || !draft.trim() || !activeProvider) {
      return;
    }

    const prompt = draft.trim();
    const nextModel =
      selectedModel && availableModels.includes(selectedModel)
        ? selectedModel
        : activeProvider.defaultModel;
    const modelSwitchNote = getModelSwitchNote(selectedSession, activeProvider, nextModel);
    if (modelSwitchNote) {
      appendSessionNote(selectedSession.id, modelSwitchNote);
    }
    const optimisticId = appendOptimisticUserMessage(selectedSession.id, prompt);
    setIsSending(true);
    setSendError(null);
    setDraft("");

    try {
      if (
        activeProvider.name === "codex" ||
        activeProvider.name === "cursor" ||
        activeProvider.name === "gemini"
      ) {
        const localResult = await window.hawkcode.generateLocalAgentReply({
          provider: activeProvider.name,
          sessionId: selectedSession.id,
          model: nextModel,
          messages: buildLocalProviderMessages(prompt)
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
          model: nextModel,
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
    if (!selectedWorkspace?.id || !selectedGithubRepoUrl || !workspaceGithub?.connected) {
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
            repoUrl: selectedGithubRepoUrl,
            ...(githubProjectName.trim() ? { projectName: githubProjectName.trim() } : {})
          })
        }
      );

      const data = (await response.json().catch(() => null)) as
        | { repo?: WorkspaceGithubRepo; syncError?: string | null; message?: string; error?: string }
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
          repos: nextRepos,
          availableRepos: current?.availableRepos ?? []
        };
      });
      setGithubRepoQuery("");
      setSelectedGithubRepoUrl("");
      setGithubProjectName("");
      if (data.syncError) {
        setGitError(`Repo connected, but initial server sync failed: ${data.syncError}`);
      }
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
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold">HawkCode</div>
              <div className="text-[11px] text-muted-foreground">{authUser}</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Sessions
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {allSessions.length} across {workspaceTree.length} workspaces
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={handleCreateSession}>
                  New
                </Button>
              </div>
              <input
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                placeholder="Search sessions, branches, messages..."
                className="mt-3 h-10 w-full rounded-xl border border-border bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
          <Separator className="my-3" />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Workspaces
            </div>
            {filteredWorkspaces.map((workspace) => (
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
                          className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                            selectedSessionId === session.id
                              ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(74,222,128,0.18)]"
                              : "border-border bg-background/40 hover:bg-accent"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{session.title}</span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                              {session.status}
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                            {getSessionPreview(session)}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            <span>{session.updated}</span>
                            <span>{session.model}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                            <span className="rounded-full border border-border/70 px-2 py-0.5">
                              {session.branch}
                            </span>
                            <span className="rounded-full border border-border/70 px-2 py-0.5">
                              {getMessageCountLabel(session.messages.length)}
                            </span>
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
            {filteredWorkspaces.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No sessions match “{sessionQuery.trim()}”.
              </div>
            ) : null}
          </div>
          <div className="mt-4 pt-3">
            <Button size="sm" variant="outline" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        <main className="relative flex min-h-0 flex-col overflow-hidden">
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
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-2xl border border-border/70 bg-card/70 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Conversation pulse
                  </div>
                  <div className="mt-2 text-sm text-foreground">
                    {getSessionPreview(selectedSession)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="rounded-2xl border border-border/70 bg-card/50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em]">Messages</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {selectedSession.messages.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card/50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em]">Context</div>
                    <div className="mt-1 text-lg font-semibold text-foreground">
                      {selectedSession.contextCount}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
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

          {selectedSession ? (
            <>
              <div className="border-b border-border px-6 pt-4">
                <div className="flex items-center gap-2 overflow-x-auto pb-3">
                  <button
                    type="button"
                    onClick={() => setActiveCenterTab("chat")}
                    className={`rounded-t-xl border px-3 py-2 text-sm transition-colors ${
                      activeCenterTab === "chat"
                        ? "border-border border-b-background bg-background text-foreground"
                        : "border-transparent bg-card/60 text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    Chat
                  </button>
                  {selectedSession?.worktree ? (
                    <button
                      type="button"
                      onClick={() => setActiveCenterTab("session-git")}
                      className={`rounded-t-xl border px-3 py-2 text-sm transition-colors ${
                        activeCenterTab === "session-git"
                          ? "border-border border-b-background bg-background text-foreground"
                          : "border-transparent bg-card/60 text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      Git
                    </button>
                  ) : null}
                  {openEditorTabs.map((tab) => (
                    <div
                      key={tab.path}
                      className={`flex items-center gap-2 rounded-t-xl border px-3 py-2 text-sm ${
                        activeCenterTab === tab.path
                          ? "border-border border-b-background bg-background text-foreground"
                          : "border-transparent bg-card/60 text-muted-foreground"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveCenterTab(tab.path)}
                        className="max-w-56 truncate text-left"
                      >
                        {tab.path.split("/").pop()}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloseEditorTab(tab.path)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                        aria-label={`Close ${tab.path}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {activeCenterTab === "chat" ? (
                <div
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5"
                >
                  <div className="mx-auto flex max-w-4xl flex-col gap-4 pb-8">
                    {selectedSession.messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${
                          message.role === "system"
                            ? "justify-center"
                            : message.role === "user"
                              ? "justify-end"
                              : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-3xl rounded-3xl px-4 py-3 ${
                            message.role === "system"
                              ? "border border-dashed border-border bg-background text-muted-foreground"
                              : message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-card"
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] opacity-70">
                            <span>
                              {message.role === "system"
                                ? "Session note"
                                : message.role === "user"
                                  ? "You"
                                  : "Assistant"}
                            </span>
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
                </div>
              ) : activeCenterTab === "session-git" ? (
                <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
                  <div className="mx-auto grid h-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.4fr)_360px]">
                    <div className="min-h-0 overflow-hidden rounded-3xl border border-border bg-card/70">
                      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div>
                          <div className="font-medium text-foreground">Session Git Review</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {sessionGit?.branch ?? selectedSession?.worktree?.branch ?? "No branch"} into {sessionGit?.baseBranch ?? "main"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{sessionGit?.clean ? "Clean" : `${sessionGit?.changedFiles.length ?? 0} changed`}</span>
                          {sessionGit && sessionGit.ahead !== null && sessionGit.behind !== null ? (
                            <span>
                              ahead {sessionGit.ahead} / behind {sessionGit.behind}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="min-h-0 h-full overflow-y-auto p-4">
                        {sessionGit?.changedFiles.length ? (
                          <div className="space-y-2">
                            {sessionGit.changedFiles.map((file) => (
                              <div
                                key={file.path}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/50 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm text-foreground">{file.path}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {file.untracked ? "New file" : file.staged ? "Staged changes" : "Modified file"}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    selectedSession?.serverSessionId &&
                                    void loadSessionFile(selectedSession.serverSessionId, file.path)
                                  }
                                >
                                  Open file
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                            No changed files in this session worktree yet.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-h-0 overflow-y-auto rounded-3xl border border-border bg-card/70 p-4">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-border bg-background/50 px-4 py-3">
                          <div className="text-sm font-medium text-foreground">Commit</div>
                          <div className="mt-3 flex gap-2">
                            <input
                              value={commitMessage}
                              onChange={(event) => setCommitMessage(event.target.value)}
                              placeholder="Commit message"
                              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                            />
                            <Button size="sm" variant="outline" onClick={() => handleAskAiForSessionGit("commit")}>
                              AI Help
                            </Button>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 justify-center"
                              onClick={handleCommitSessionChanges}
                              disabled={isCommitting || !commitMessage.trim()}
                            >
                              {isCommitting ? "Committing..." : "Commit"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 justify-center"
                              onClick={handlePushSessionBranch}
                              disabled={isPushing || !sessionGit?.canPush}
                            >
                              {isPushing ? "Pushing..." : "Push"}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background/50 px-4 py-3">
                          <div className="text-sm font-medium text-foreground">Pull Request</div>
                          <div className="mt-3 flex gap-2">
                            <input
                              value={pullRequestTitle}
                              onChange={(event) => setPullRequestTitle(event.target.value)}
                              placeholder="Pull request title"
                              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                            />
                            <Button size="sm" variant="outline" onClick={() => handleAskAiForSessionGit("pr")}>
                              AI Help
                            </Button>
                          </div>
                          <textarea
                            value={pullRequestBody}
                            onChange={(event) => setPullRequestBody(event.target.value)}
                            placeholder="Pull request body"
                            className="mt-3 min-h-40 w-full rounded-2xl border border-border bg-background px-3 py-3 text-sm outline-none transition focus:border-foreground/30"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 w-full justify-center"
                            onClick={handleCreatePullRequest}
                            disabled={isCreatingPullRequest || !sessionGit?.canCreatePr}
                          >
                            {isCreatingPullRequest ? "Opening PR..." : "Open pull request"}
                          </Button>
                          {pullRequestUrl ? (
                            <button
                              type="button"
                              className="mt-3 block truncate text-left text-primary underline underline-offset-4"
                              onClick={() => void window.hawkcode.openExternalUrl(pullRequestUrl)}
                            >
                              {pullRequestUrl}
                            </button>
                          ) : null}
                        </div>

                        {sessionGitError ? (
                          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {sessionGitError}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : activeEditorTab ? (
                <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
                  <div className="mx-auto flex h-full max-w-5xl flex-col rounded-3xl border border-border bg-card/70">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                      <div>
                        <div className="font-medium text-foreground">{activeEditorTab.path}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {activeEditorView === "diff"
                            ? activeEditorTab.hasDiff
                              ? "Showing git diff for this file."
                              : "No git diff for this file yet."
                            : selectedFileLineRange
                              ? selectedFileLineRange.start === selectedFileLineRange.end
                                ? `Selected line ${selectedFileLineRange.start}`
                                : `Selected lines ${selectedFileLineRange.start}-${selectedFileLineRange.end}`
                              : activeEditorTab.isEditing
                                ? "Manual edit mode is on."
                                : "Click a line number to select it. Shift-click to extend the range."}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-lg border border-border bg-background/70 p-1">
                          <button
                            type="button"
                            onClick={() => setActiveEditorView("source")}
                            className={`rounded-md px-2 py-1 text-xs ${
                              activeEditorView === "source"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Source
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveEditorView("diff")}
                            className={`rounded-md px-2 py-1 text-xs ${
                              activeEditorView === "diff"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Diff
                          </button>
                        </div>
                        <div className="flex items-center gap-1 rounded-lg border border-border bg-background/70 p-1">
                          <button
                            type="button"
                            onClick={() => handleToggleEditorMode(false)}
                            className={`rounded-md px-2 py-1 text-xs ${
                              !activeEditorTab.isEditing
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleEditorMode(true)}
                            className={`rounded-md px-2 py-1 text-xs ${
                              activeEditorTab.isEditing
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            Edit
                          </button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {activeEditorTab.size} bytes
                        </div>
                        {activeEditorTab.isEditing ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={activeEditorTab.isSaving || activeEditorTab.draftContent === activeEditorTab.savedContent}
                            onClick={handleSaveEditorTab}
                          >
                            {activeEditorTab.isSaving ? "Saving..." : "Save"}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedFileLineRange || activeEditorView === "diff"}
                          onClick={handleAddSelectionToChat}
                        >
                          Add to chat
                        </Button>
                      </div>
                    </div>
                    {activeEditorView === "diff" ? (
                      <div className="min-h-0 flex-1 overflow-auto">
                        <pre className="min-w-max p-4 font-mono text-[12px] leading-6 text-foreground">
                          {activeEditorTab.diffContent || "No changes yet."}
                        </pre>
                      </div>
                    ) : activeEditorTab.isEditing ? (
                      <div className="min-h-0 flex-1 overflow-auto p-4">
                        <textarea
                          value={activeEditorTab.draftContent}
                          onChange={(event) => handleEditorDraftChange(event.target.value)}
                          spellCheck={false}
                          className="h-full min-h-full w-full resize-none rounded-2xl border border-border bg-background/60 p-4 font-mono text-[12px] leading-6 text-foreground outline-none"
                        />
                      </div>
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto">
                        <div className="min-w-max font-mono text-[12px] leading-6">
                          {selectedFileLines.map((line, index) => {
                            const lineNumber = index + 1;
                            const isSelected =
                              selectedFileLineRange !== null &&
                              lineNumber >= selectedFileLineRange.start &&
                              lineNumber <= selectedFileLineRange.end;

                            return (
                              <div
                                key={`${activeEditorTab.path}-${lineNumber}`}
                                className={`grid grid-cols-[64px_minmax(0,1fr)] ${
                                  isSelected ? "bg-primary/10" : "hover:bg-accent/30"
                                }`}
                              >
                                <button
                                  type="button"
                                  className={`border-r border-border px-3 py-0.5 text-right text-[11px] ${
                                    isSelected ? "text-foreground" : "text-muted-foreground"
                                  }`}
                                  onClick={(event) => handleSelectFileLine(lineNumber, event.shiftKey)}
                                >
                                  {lineNumber}
                                </button>
                                <div className="px-4 py-0.5 whitespace-pre">
                                  {line || " "}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {activeEditorTab.truncated ? (
                      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                        Preview truncated.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-6">
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
          {selectedSession && activeCenterTab === "chat" && !isNearLatest ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-36 flex justify-center px-6">
              <button
                type="button"
                onClick={scrollChatToLatest}
                className="pointer-events-auto rounded-full border border-border bg-card/90 px-4 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur"
              >
                Jump to latest
              </button>
            </div>
          ) : null}
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
                    ref={draftTextareaRef}
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
                    className="max-h-60 min-h-28 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div>
                        {activeProvider
                          ? `Using ${activeProvider?.label ?? "agent"}${selectedModel ? ` · ${selectedModel}` : ""} for this reply.`
                          : geminiSetupSelected
                            ? "Gemini CLI is selected but not installed yet."
                          : geminiLoginRequired
                            ? "Gemini CLI is installed, but Google sign-in is required."
                          : cursorSetupSelected
                            ? "Cursor CLI is selected but not installed yet."
                          : cursorLoginRequired
                            ? "Cursor CLI is installed, but login is required."
                          : "No agent providers available yet."}
                      </div>
                      <div>Enter sends. Shift+Enter adds a new line.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedProvider ?? ""}
                        onChange={(event) =>
                          setSelectedProvider(event.target.value as "codex" | "cursor" | "gemini" | "openrouter")
                        }
                        className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                        disabled={providerOptions.length === 0 || isSending}
                      >
                        {providerOptions.length === 0 ? <option value="">No providers</option> : null}
                        {providerOptions.map((provider) => (
                          <option key={provider.name} value={provider.name}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedModel}
                        onChange={(event) => setSelectedModel(event.target.value)}
                        className="h-9 w-44 rounded-md border border-border bg-background px-3 text-sm"
                        disabled={
                          !activeProvider ||
                          isSending ||
                          geminiSetupSelected ||
                          geminiLoginRequired ||
                          cursorSetupSelected ||
                          cursorLoginRequired
                        }
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
                        variant="ghost"
                        disabled={!draft.trim() || isSending}
                        onClick={() => setDraft("")}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          !selectedSession ||
                          !draft.trim() ||
                          !activeProvider ||
                          isSending ||
                          geminiSetupSelected ||
                          geminiLoginRequired ||
                          cursorSetupSelected ||
                          cursorLoginRequired
                        }
                        onClick={handleSend}
                      >
                        {isSending ? "Sending..." : "Send"}
                      </Button>
                    </div>
                  </div>
                  {geminiSetupSelected ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-background/80 px-4 py-3 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Gemini CLI setup required</div>
                      <div className="mt-1">
                        Install the CLI, then restart HawkCode or reselect the provider.
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-foreground">
                        npm install -g @google/gemini-cli
                      </div>
                      <div className="mt-2">
                        HawkCode uses Gemini CLI with Google sign-in, not API keys.
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void refreshAvailableProviders()}
                        >
                          Recheck Gemini CLI
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void window.hawkcode.openExternalUrl("https://geminicli.com/docs/get-started/authentication")}
                        >
                          Open Gemini auth docs
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {geminiLoginRequired ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-background/80 px-4 py-3 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Gemini CLI login required</div>
                      <div className="mt-1">
                        Start `gemini`, choose `Sign in with Google`, and use the Google account tied to your Google AI plan.
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-foreground">gemini</div>
                      <div className="mt-2">{geminiCli.statusText}</div>
                      {geminiCli.command ? (
                        <div className="mt-1">Detected command: `{geminiCli.command}`</div>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void refreshAvailableProviders()}
                        >
                          Recheck Gemini CLI
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void window.hawkcode.openExternalUrl("https://geminicli.com/docs/get-started/authentication")}
                        >
                          Open Gemini auth docs
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {cursorSetupSelected ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-background/80 px-4 py-3 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Cursor CLI setup required</div>
                      <div className="mt-1">
                        Install the CLI, then restart HawkCode or reselect the provider.
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-foreground">
                        curl https://cursor.com/install -fsS | bash
                      </div>
                      <div className="mt-2">
                        HawkCode auto-discovers `agent` and `cursor-agent` from `PATH`,
                        `~/.local/bin`, and `~/.cursor/bin`.
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void refreshAvailableProviders()}
                        >
                          Recheck Cursor CLI
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void window.hawkcode.openExternalUrl("https://cursor.com/docs/cli/using")}
                        >
                          Open Cursor CLI docs
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {cursorLoginRequired ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-background/80 px-4 py-3 text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Cursor CLI login required</div>
                      <div className="mt-1">
                        The CLI is installed at `{cursorCli.command ?? "agent"}`, but it is not logged in yet.
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-foreground">agent login</div>
                      <div className="mt-2">{cursorCli.statusText}</div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void window.hawkcode.startCursorCliAuth().then(setCursorCli)}
                          disabled={cursorCli.inProgress}
                        >
                          {cursorCli.inProgress ? "Waiting for Cursor login..." : "Connect Cursor CLI"}
                        </Button>
                        {cursorCli.authUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void window.hawkcode.openExternalUrl(cursorCli.authUrl!)}
                          >
                            Open login browser
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void refreshAvailableProviders()}
                        >
                          Recheck Cursor CLI
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void window.hawkcode.openExternalUrl("https://cursor.com/docs/cli/using")}
                        >
                          Open Cursor CLI docs
                        </Button>
                      </div>
                    </div>
                  ) : null}
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
                    <CardTitle>Session Files</CardTitle>
                    <CardDescription>
                      {selectedSession
                        ? "Attach a synced repo to this session and create a dedicated worktree."
                        : "Select a session to inspect server-managed files."}
                    </CardDescription>
                  </CardHeader>
                  {selectedSession ? (
                    <CardContent className="space-y-3 text-xs text-muted-foreground">
                      {syncedRepos.length > 0 ? (
                        <div className="space-y-2">
                          <div className="rounded-lg border border-border px-3 py-2">
                            <div className="font-medium text-foreground">Project</div>
                            <select
                              value={selectedSession.projectId ?? ""}
                              onChange={(event) => void handleAssignSessionProject(event.target.value)}
                              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            >
                              <option value="">Select a synced repo</option>
                              {syncedRepos.map((repo) => (
                                <option key={repo.projectId} value={repo.projectId}>
                                  {repo.projectName} · {repo.repoName}
                                </option>
                              ))}
                            </select>
                            {selectedProjectRepo ? (
                              <div className="mt-2 truncate">Base checkout: {selectedProjectRepo.serverSync.path}</div>
                            ) : null}
                          </div>

                          <div className="rounded-lg border border-border px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="font-medium text-foreground">Session worktree</div>
                                <div className="mt-1">
                                  {selectedSession.worktree
                                    ? `${selectedSession.worktree.branch} · ${selectedSession.worktree.path}`
                                    : "No session worktree yet."}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={handleCreateSessionWorktree}
                                disabled={!selectedSession.projectId || isCreatingWorktree}
                              >
                                {isCreatingWorktree ? "Creating..." : selectedSession.worktree ? "Reset worktree" : "Create worktree"}
                              </Button>
                            </div>
                          </div>

                          {fileError ? <div className="text-destructive">{fileError}</div> : null}

                          {sessionFiles?.worktree ? (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-border px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="font-medium text-foreground">
                                    {sessionFiles.currentPath || "/"}
                                  </div>
                                  {sessionFiles.currentPath ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const parts = sessionFiles.currentPath.split("/").filter(Boolean);
                                        parts.pop();
                                        void loadSessionFiles(
                                          selectedSession.serverSessionId ?? selectedSession.id,
                                          parts.join("/")
                                        );
                                      }}
                                    >
                                      Up
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="mt-2 space-y-1">
                                  {isLoadingFiles ? (
                                    <div>Loading files...</div>
                                  ) : sessionFiles.entries.length > 0 ? (
                                    sessionFiles.entries.map((entry) => (
                                      <button
                                        key={entry.path}
                                        type="button"
                                        className="flex w-full items-center justify-between rounded-md border border-border px-2 py-2 text-left hover:bg-accent"
                                        onClick={() =>
                                          entry.type === "directory"
                                            ? void loadSessionFiles(
                                                selectedSession.serverSessionId ?? selectedSession.id,
                                                entry.path
                                              )
                                            : void loadSessionFile(
                                                selectedSession.serverSessionId ?? selectedSession.id,
                                                entry.path
                                              )
                                        }
                                      >
                                        <span>
                                          {entry.type === "directory" ? "Dir" : "File"} · {entry.name}
                                        </span>
                                        <span>{entry.type === "file" ? `${entry.size ?? 0} bytes` : ""}</span>
                                      </button>
                                    ))
                                  ) : (
                                    <div>No files in this directory.</div>
                                  )}
                                </div>
                              </div>
                              {activeEditorTab ? (
                                <div className="rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground">
                                  Open in center panel: <span className="text-foreground">{activeEditorTab.path}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border px-3 py-2">
                              Create a session worktree to browse files and attach repo context.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border px-3 py-2">
                          Sync a repo to the server first, then attach it to this session.
                        </div>
                      )}
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
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <CardTitle>Session Git</CardTitle>
                        <CardDescription>Commit, push, and open a pull request for this session branch.</CardDescription>
                      </div>
                      {selectedSession?.worktree ? (
                        <Button size="sm" variant="outline" onClick={() => setActiveCenterTab("session-git")}>
                          Expand
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-muted-foreground">
                    {selectedSession?.worktree ? (
                      <>
                        <div className="rounded-lg border border-border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span>Branch</span>
                            <span className="text-foreground">{sessionGit?.branch ?? selectedSession.worktree.branch}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span>Base</span>
                            <span>{sessionGit?.baseBranch ?? "main"}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span>Status</span>
                            <span>{sessionGit?.clean ? "Clean" : `${sessionGit?.changedFiles.length ?? 0} changed files`}</span>
                          </div>
                        </div>

                        {sessionGit?.changedFiles.length ? (
                          <div className="rounded-lg border border-border px-3 py-2">
                            <div className="font-medium text-foreground">Changed files</div>
                            <div className="mt-2 space-y-1">
                              {sessionGit.changedFiles.map((file) => (
                                <div key={file.path} className="flex items-center justify-between gap-2">
                                  <span className="truncate">{file.path}</span>
                                  <span>
                                    {file.untracked ? "New" : file.staged ? "Staged" : "Modified"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <input
                          value={commitMessage}
                          onChange={(event) => setCommitMessage(event.target.value)}
                          placeholder="Commit message"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 justify-center"
                            onClick={handleCommitSessionChanges}
                            disabled={isCommitting || !commitMessage.trim()}
                          >
                            {isCommitting ? "Committing..." : "Commit"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 justify-center"
                            onClick={handlePushSessionBranch}
                            disabled={isPushing || !sessionGit?.canPush}
                          >
                            {isPushing ? "Pushing..." : "Push"}
                          </Button>
                        </div>
                        <input
                          value={pullRequestTitle}
                          onChange={(event) => setPullRequestTitle(event.target.value)}
                          placeholder="Pull request title"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full justify-center"
                          onClick={handleCreatePullRequest}
                          disabled={isCreatingPullRequest || !sessionGit?.canCreatePr}
                        >
                          {isCreatingPullRequest ? "Opening PR..." : "Open pull request"}
                        </Button>
                        {pullRequestUrl ? (
                          <button
                            type="button"
                            className="block truncate text-left text-primary underline underline-offset-4"
                            onClick={() => void window.hawkcode.openExternalUrl(pullRequestUrl)}
                          >
                            {pullRequestUrl}
                          </button>
                        ) : null}
                        {sessionGitError ? <div className="text-destructive">{sessionGitError}</div> : null}
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2">
                        Create a session worktree first to commit, push, and open a PR.
                      </div>
                    )}
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
                    <CardDescription>Workspace owners can select a GitHub repo for this workspace.</CardDescription>
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
                          value={githubRepoQuery}
                          onChange={(event) => setGithubRepoQuery(event.target.value)}
                          placeholder="Search repos by owner/name"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <select
                          value={selectedGithubRepoUrl}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSelectedGithubRepoUrl(value);
                            const selectedRepo = (workspaceGithub.availableRepos ?? []).find(
                              (repo) => repo.repoUrl === value
                            );
                            setGithubProjectName(selectedRepo?.name ?? "");
                          }}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        >
                          <option value="">
                            {filteredAvailableGithubRepos.length > 0 ? "Select a GitHub repo" : "No repos found"}
                          </option>
                          {filteredAvailableGithubRepos.map((repo) => (
                            <option key={repo.repoUrl} value={repo.repoUrl}>
                              {repo.fullName}
                              {repo.private ? " (private)" : ""}
                            </option>
                          ))}
                        </select>
                        <input
                          value={githubProjectName}
                          onChange={(event) => setGithubProjectName(event.target.value)}
                          placeholder="Workspace project name"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/30"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full justify-center"
                          onClick={handleConnectGithub}
                          disabled={
                            isConnectingGithub ||
                            !selectedGithubRepoUrl ||
                            !workspaceGithub.connected ||
                            githubAuth.inProgress
                          }
                        >
                          {isConnectingGithub ? "Connecting..." : "Connect repo"}
                        </Button>
                      </div>
                    ) : workspaceGithub && !isLoadingGithub ? (
                      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                        Repo selection is owner-only. Ask the workspace owner to connect a repo.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Server checkouts</CardTitle>
                    <CardDescription>Repos synced onto the HawkCode server for schedules and agents.</CardDescription>
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
                            <button
                              type="button"
                              className="mt-1 block truncate text-left text-primary underline underline-offset-4"
                              onClick={() => void window.hawkcode.openExternalUrl(repo.repoUrl)}
                            >
                              {repo.repoUrl}
                            </button>
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
                                  {repo.serverSync.modifiedFiles} modified · {repo.serverSync.untrackedFiles} untracked
                                </div>
                                <div className="truncate">Path: {repo.serverSync.path}</div>
                                {repo.serverSync.lastSyncedAt ? (
                                  <div>Last synced {formatTimestamp(repo.serverSync.lastSyncedAt)}</div>
                                ) : null}
                                {repo.serverSync.lastCommit ? (
                                  <div>
                                    Last commit {repo.serverSync.lastCommit.shortSha} · {repo.serverSync.lastCommit.subject}
                                  </div>
                                ) : null}
                              </div>
                            ) : repo.serverSync.status === "error" ? (
                              <div className="mt-2 space-y-1 text-destructive">
                                <div>Server checkout is unavailable.</div>
                                {repo.serverSync.error ? <div className="text-xs">{repo.serverSync.error}</div> : null}
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-muted-foreground">
                                This repo is connected, but the server has not synced files yet.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                        No Git repos connected for this workspace yet.
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
                    <CardDescription>Workspace automation now runs from the server checkout.</CardDescription>
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

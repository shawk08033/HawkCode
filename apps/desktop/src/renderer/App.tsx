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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type SessionRecord = {
  id: string;
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

const IS_DEV = !window.hawkcode?.version ? false : true;
const DEFAULT_URL = IS_DEV ? "http://localhost:3001" : "https://localhost:3001";

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "ws-1": true,
    "ws-2": false
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const workspaceTree = useMemo<WorkspaceRecord[]>(
    () => [
      {
        id: "ws-1",
        name: "HawkCode",
        sessions: [
          {
            id: "sess-1",
            title: "Auth + invites",
            updated: "2m ago",
            model: "GPT-5",
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
              },
              {
                id: "m-3",
                role: "user",
                content: "Turn that into a concrete follow-up plan with the UI implications called out.",
                timestamp: "9:17 AM"
              },
              {
                id: "m-4",
                role: "assistant",
                content:
                  "I would separate it into three tracks: fix certificate trust ergonomics, tighten auth-state feedback in the desktop UI, and add one end-to-end setup smoke test before more invite features land.",
                timestamp: "9:18 AM"
              }
            ]
          },
          {
            id: "sess-2",
            title: "Desktop onboarding",
            updated: "40m ago",
            model: "GPT-5",
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
            model: "GPT-5 mini",
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
    ],
    []
  );

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

  useEffect(() => {
    window.hawkcode.getServerConfig().then((config) => {
      if (config.serverUrl) {
        setServerUrl(config.serverUrl);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedSessionId && allSessions.length > 0) {
      setSelectedSessionId(allSessions[0].id);
    }
  }, [selectedSessionId, allSessions]);

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

  useEffect(() => {
    setDraft("");
  }, [selectedSessionId]);

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
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[240px_1fr_300px]">
        <aside className="flex flex-col border-r border-border bg-card px-3 py-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">HawkCode</div>
            <div className="text-[11px] text-muted-foreground">{authUser}</div>
          </div>
          <Separator className="my-3" />
          <div className="space-y-3 overflow-y-auto pr-1">
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
                <Button size="sm" variant="outline">
                  Share
                </Button>
                <Button size="sm">New session</Button>
              </div>
            </div>
            {selectedSession ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                  Model {selectedSession.model}
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
                    Context, files, and tools stay attached to the selected session.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline">
                      Attach
                    </Button>
                    <Button size="sm" disabled={!selectedSession}>
                      Send
                    </Button>
                  </div>
                </div>
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
                        `apps/desktop/src/renderer/App.tsx`
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2">
                        `apps/server/src/routes/auth.ts`
                      </div>
                      <div className="rounded-lg border border-border px-3 py-2">
                        `packages/shared/src/schemas.ts`
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
                      <span>Model</span>
                      <span>{selectedSession?.model ?? "None"}</span>
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
                    <CardTitle>GitHub</CardTitle>
                    <CardDescription>PR status, commits, and code review.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button size="sm" variant="outline">
                      Connect repo
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

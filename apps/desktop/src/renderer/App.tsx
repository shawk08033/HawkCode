import { useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Separator } from "./components/ui/separator";

type Status = {
  state: "idle" | "checking" | "ok" | "error";
  message?: string;
  checkedAt?: string;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "ws-1": true,
    "ws-2": false
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const workspaceTree = useMemo(
    () => [
      {
        id: "ws-1",
        name: "HawkCode",
        sessions: [
          { id: "sess-1", title: "Auth + invites", updated: "2m ago" },
          { id: "sess-2", title: "Desktop onboarding", updated: "40m ago" }
        ],
        schedules: [
          { id: "sch-1", title: "Nightly test run" },
          { id: "sch-2", title: "Morning standup summary" }
        ]
      },
      {
        id: "ws-2",
        name: "Internal Tools",
        sessions: [{ id: "sess-3", title: "Cron runner", updated: "1d ago" }],
        schedules: [{ id: "sch-3", title: "Dependency audit" }]
      }
    ],
    []
  );

  const sessions = useMemo(() => workspaceTree[0]?.sessions ?? [], [workspaceTree]);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    window.hawkcode.getServerConfig().then((config) => {
      if (config.serverUrl) {
        setServerUrl(config.serverUrl);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

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
                <span className={authMessage?.includes("failed") ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
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
      <div className="grid min-h-screen grid-cols-[220px_1fr_260px]">
        <aside className="border-r border-border bg-card px-3 py-2">
          <div className="space-y-1">
            <div className="text-sm font-semibold">HawkCode</div>
            <div className="text-[11px] text-muted-foreground">{authUser}</div>
          </div>
          <Separator className="my-2" />
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Workspaces</div>
            <div className="space-y-2">
              {workspaceTree.map((workspace) => (
                <div key={workspace.id} className="space-y-2">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-sm"
                    onClick={() => toggleWorkspace(workspace.id)}
                    aria-expanded={expanded[workspace.id]}
                  >
                    <span className={`transition-transform ${expanded[workspace.id] ? "rotate-90" : ""}`}>
                      ▸
                    </span>
                    <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
                    {workspace.name}
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
                            className={`flex w-full items-center justify-between rounded-md border px-2 py-1 text-xs transition-colors ${
                              selectedSessionId === session.id
                                ? "border-primary text-primary"
                                : "border-border text-foreground"
                            }`}
                          >
                            <span>{session.title}</span>
                            <span className="text-[10px] text-muted-foreground">{session.updated}</span>
                          </button>
                        ))}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Schedules
                      </div>
                      <div className="space-y-1">
                        {workspace.schedules.map((schedule) => (
                          <div key={schedule.id} className="rounded-md border border-border px-2 py-1 text-xs">
                            {schedule.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto pt-4">
            <Button size="sm" variant="outline" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        <main className="border-r border-border px-5 py-4">
          <div className="flex items-start justify-between border-b border-border pb-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Session</div>
              <h1 className="text-2xl font-semibold">
                {selectedSession?.title ?? "Choose a session"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm">New session</Button>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            {selectedSession ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <div className="text-sm font-medium">{selectedSession.title}</div>
                    <div className="text-xs text-muted-foreground">Updated {selectedSession.updated}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm">Open chat</Button>
                    <Button size="sm" variant="outline">
                      Attach context
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>Pick a prompt or continue the thread.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline">
                      Summarize repo
                    </Button>
                    <Button size="sm" variant="outline">
                      Review PR status
                    </Button>
                    <Button size="sm" variant="outline">
                      Run tests
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Pick a session from the workspace tree or create a new one.</p>
                <Button size="sm">New session</Button>
              </div>
            )}
          </div>
        </main>

        <aside className="px-4 py-3">
          <Tabs defaultValue="integrations">
            <TabsList>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
            </TabsList>
            <TabsContent value="integrations">
              <div className="space-y-3">
                <Card>
                  <CardHeader>
                    <CardTitle>GitHub</CardTitle>
                    <CardDescription>Connect repositories and view PR status.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button size="sm" variant="outline">
                      Connect
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Services</CardTitle>
                    <CardDescription>Manage webhooks, schedules, and secrets.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button size="sm" variant="outline">
                      Configure
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>Session updates and jobs.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <div>2m ago · Agent prepared context bundle.</div>
                  <div>10m ago · You updated session goals.</div>
                  <div>1h ago · GitHub checks completed on main.</div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="context">
              <Card>
                <CardHeader>
                  <CardTitle>Context</CardTitle>
                  <CardDescription>Attach files, prompts, and repo refs.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button size="sm" variant="outline">
                    Add context
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

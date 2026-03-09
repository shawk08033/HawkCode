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

const DEFAULT_URL = "http://localhost:3001";

export default function AppHome() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[220px_1fr_260px]">
        <aside className="flex h-full flex-col border-r border-border bg-card px-3 py-2">
          <div className="space-y-1">
            <div className="text-sm font-semibold">HawkCode</div>
            <div className="text-[11px] text-muted-foreground">{user?.email ?? "Loading..."}</div>
          </div>
          <Separator className="my-2" />
          <div className="flex-1 space-y-2">
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
          <div className="pt-2">
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
              {isAdmin ? (
                <Button size="sm" variant="outline" onClick={() => (window.location.href = "/app/admin")}>
                  Admin
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => (window.location.href = "/app/settings")}>
                Settings
              </Button>
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
                <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <div>2m ago · Agent prepared context bundle.</div>
                  <div>10m ago · You updated session goals.</div>
                  <div>1h ago · GitHub checks completed on main.</div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardHeader>
                      <CardTitle>Context pack</CardTitle>
                      <CardDescription>Attach files, diffs, or repo paths.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button size="sm" variant="outline">
                        Add files
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Sandbox</CardTitle>
                      <CardDescription>Run shell commands safely.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button size="sm" variant="outline">
                        Open terminal
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Schedules</CardTitle>
                      <CardDescription>Create cron jobs for prompts.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button size="sm" variant="outline">
                        New schedule
                      </Button>
                    </CardContent>
                  </Card>
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

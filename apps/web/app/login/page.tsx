"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = {
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
};

const IS_DEV = process.env.NODE_ENV === "development";
const DEFAULT_URL = IS_DEV ? "http://localhost:3001" : "https://localhost:3001";

export default function LoginPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/me`, {
          method: "GET",
          credentials: "include"
        });
        if (response.ok) {
          window.location.href = "/app";
        }
      } catch {
        return;
      }
    }
    if (serverUrl) {
      void checkAuth();
    }
  }, [serverUrl]);

  async function handleLogin() {
    if (serverUrl.startsWith("http://") && !IS_DEV) {
      setStatus({ state: "error", message: "TLS required. Use https://" });
      return;
    }
    setStatus({ state: "loading" });
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        setStatus({ state: "error", message: "Login failed." });
        return;
      }
      setStatus({ state: "ok", message: "Logged in." });
      window.location.href = "/app";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed.";
      setStatus({ state: "error", message });
    }
  }

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
              <span className={status.state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {status.message ?? " "}
              </span>
              <Button size="sm" onClick={handleLogin}>
                {status.state === "loading" ? "Signing in..." : "Sign in"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

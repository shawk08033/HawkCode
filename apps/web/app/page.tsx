"use client";

import { useEffect } from "react";
import { Badge, ButtonLink, Card } from "@hawkcode/ui";

const IS_DEV = process.env.NODE_ENV === "development";

export default function Home() {
  useEffect(() => {
    if (IS_DEV) {
      window.location.href = "/login";
    }
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <div className="header">
          <Badge label="HawkCode" />
          <h1>Self-hosted agent coding workspaces.</h1>
          <p>
            Secure sessions, sandboxed tools, and team collaboration with a
            private server sync.
          </p>
        </div>
        <div className="actions">
          <ButtonLink label="Get started" href="/connect" />
          <ButtonLink label="Docs" href="/docs" variant="outline" />
        </div>
      </section>
      <section className="grid">
        <Card
          eyebrow="Sandbox"
          title="Run tools safely"
          description="Per-session Docker sandboxes keep commands isolated and reproducible."
        />
        <Card
          eyebrow="Collaboration"
          title="Share sessions"
          description="Invite-only access with role controls and real-time sync."
        />
        <Card
          eyebrow="Automation"
          title="Schedules built in"
          description="Cron jobs can run prompts or shell commands inside the sandbox."
        />
      </section>
    </main>
  );
}

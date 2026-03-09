"use client";

import { useEffect, useState } from "react";
import { Badge, Button, ButtonLink } from "@hawkcode/ui";

type User = {
  id: string;
  email: string;
};

const DEFAULT_URL = "http://localhost:3001";

export default function SettingsPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("hawkcode.serverUrl");
    if (saved) {
      setServerUrl(saved);
    }
  }, []);

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
      } catch {
        window.location.href = "/login";
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

  return (
    <main className="simple-page">
      <header className="simple-header">
        <div>
          <Badge label="Settings" />
          <h1>User profile</h1>
          <p>Manage your session and account preferences.</p>
        </div>
        <div className="actions">
          <ButtonLink label="Back to sessions" href="/app" variant="outline" />
        </div>
      </header>
      <section className="simple-grid">
        <div className="card-shell">
          <h3>Account</h3>
          <p>Signed in as:</p>
          <span className="time">{user?.email ?? "Loading..."}</span>
          <div className="actions">
            <Button label="Sign out" variant="outline" onClick={handleLogout} />
          </div>
        </div>
      </section>
    </main>
  );
}

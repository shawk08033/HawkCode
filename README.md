# HawkCode

HawkCode is a self-hosted agent coding workspace with workspace-scoped collaboration, private-by-default sessions, a local desktop client, and private server sync.

## Status
- Open source
- Not accepting external contributions at this time

## Current Features
- Workspace-based access control with owner, maintainer, and viewer roles
- Private-by-default sessions that belong to the creating user
- Workspace-shared sessions for broader team visibility
- Session ownership controls for rename, share/unshare, and delete
- Session delete protection once a shared session has contributions from another user
- Session checkout locks so only the active holder can submit new prompts
- Checkout lease auto-renew from web and desktop while the holder keeps the session open
- Checkout expiry indicators in the UI
- Dedicated web and desktop clients backed by the same server session history
- Local desktop Codex execution with server-synced session state

## Session And Workspace Model

### Workspaces
- Users belong to one or more workspaces with a role of `owner`, `maintainer`, or `viewer`
- Workspace owners and maintainers can access admin flows such as workspace management
- Empty workspaces still exist independently of session visibility

### Sessions
- Every session stores the user who created it
- New sessions are private by default and are only visible to their creator
- A session can be shared with the whole workspace by its owner
- Session owners can rename their sessions
- Session owners can delete their own sessions unless another user has contributed to a shared session

### Session Checkout
- A session can be checked out by one user at a time
- While a checkout is active, only the checkout holder can submit new prompts or chats
- Checkouts use a renewable 15-minute lease instead of a permanent lock
- Sending a prompt renews the lease automatically
- Web and desktop clients also renew the lease in the background while the checked-out session stays open
- The UI shows who holds the checkout and when the current lease expires

## Apps

### `apps/server`
Fastify API for auth, workspaces, sessions, session checkout, agent persistence, and server-backed sync.

### `apps/desktop`
Electron client with local Codex login, session management, checkout-aware chat UI, worktree tooling, and server sync.

### `apps/web`
Browser workspace UI with shared session browsing, workspace admin flows, session rename/share controls, and checkout-aware chat.

## Development

```bash
pnpm install
pnpm dev:all
```

Key packages:
- `apps/server`: Fastify API, auth, sessions, agent persistence
- `apps/desktop`: Electron client with local Codex login and chat UI
- `apps/web`: browser workspace UI

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm -C apps/desktop dev:with-server
pnpm -C apps/server prisma migrate deploy
pnpm -C apps/server prisma generate
```

## Setup

```bash
pnpm setup
```

This writes `hawkcode.config.json` and bootstraps the server database.

HawkCode runtime settings live in `hawkcode.config.json`. Provider settings such as `codexPath`, `codexModel`, `openrouterApiKey`, `openrouterModel`, `openrouterSiteUrl`, and `openrouterAppName` are loaded from that file, not from `CODEX_*` or `OPENROUTER_*` environment variables.

Prisma commands in `apps/server` read `databaseUrl` from `hawkcode.config.json` automatically, so normal repo workflows do not need `DATABASE_URL` in the shell after setup.

If you previously configured providers with environment variables, move those values into `hawkcode.config.json` before upgrading. Legacy `CODEX_*` and `OPENROUTER_*` variables are ignored.

After setup, make sure server migrations are applied before first use or after pulling schema changes:

```bash
pnpm -C apps/server prisma migrate deploy
pnpm -C apps/server prisma generate
```

## Admin And Workspace Management
- Workspace creation is available from the admin UI
- Workspace membership and role data are exposed by the auth API and consumed by the clients
- Workspace and session lists are loaded separately so workspace visibility does not depend on session tree loading

## Sync Model
- Session history is stored on the server so web and desktop stay in sync
- Desktop Codex replies can be generated locally and then committed back to the shared server session
- Session visibility, checkout state, and metadata are enforced on the server, not only in the client UI

## Desktop Codex

The desktop app uses the local `codex` CLI for Codex chats. Open the desktop app, sign in to HawkCode, then use the `Tools` tab to connect Codex. That flow opens the OpenAI device-auth page in your browser and uses your local ChatGPT-backed Codex login for desktop replies.

OpenRouter remains server-backed. Desktop Codex replies are generated locally, then committed back to the server so session history stays shared.

## License

MIT

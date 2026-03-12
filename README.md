# HawkCode

HawkCode is a self-hosted agent coding workspace with shared sessions, a local desktop client, and private server sync.

## Status
- Open source
- Not accepting external contributions at this time

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

## Desktop Codex

The desktop app uses the local `codex` CLI for Codex chats. Open the desktop app, sign in to HawkCode, then use the `Tools` tab to connect Codex. That flow opens the OpenAI device-auth page in your browser and uses your local ChatGPT-backed Codex login for desktop replies.

OpenRouter remains server-backed. Desktop Codex replies are generated locally, then committed back to the server so session history stays shared.

## License

MIT

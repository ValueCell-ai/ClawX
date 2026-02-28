# AGENTS.md

## Cursor Cloud specific instructions

### Overview

ClawX is a cross-platform **Electron desktop app** (React 19 + Vite + TypeScript) providing a GUI for the OpenClaw AI agent runtime. It uses pnpm as its package manager (pinned version in `package.json`'s `packageManager` field).

### Quick reference

Standard dev commands are in `package.json` scripts and `README.md`. Key ones:

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| E2E tests (Playwright) | `pnpm run test:e2e` |
| Build frontend only | `pnpm run build:vite` |

### Non-obvious caveats

- **pnpm version**: The exact pnpm version is pinned via `packageManager` in `package.json`. Use `corepack enable && corepack prepare` to activate the correct version before installing.
- **Electron on headless Linux**: The dbus errors (`Failed to connect to the bus`) are expected and harmless in a headless/cloud environment. The app still runs fine with `$DISPLAY` set (e.g., `:1` via Xvfb/VNC).
- **`pnpm run lint` race condition**: If `pnpm run uv:download` was recently run, ESLint may fail with `ENOENT: no such file or directory, scandir '/workspace/temp_uv_extract'` because the temp directory was created and removed during download. Simply re-run lint after the download script finishes.
- **Build scripts warning**: `pnpm install` may warn about ignored build scripts for `@discordjs/opus` and `koffi`. These are optional messaging-channel dependencies and the warnings are safe to ignore.
- **`pnpm run init`**: This is a convenience script that runs `pnpm install` followed by `pnpm run uv:download`. Either run `pnpm run init` or run the two steps separately.
- **Gateway startup**: When running `pnpm dev`, the OpenClaw Gateway process starts automatically on port 18789. It takes ~10-30 seconds to become ready. Gateway readiness is not required for UI development—the app functions without it (shows "connecting" state).
- **No database**: The app uses `electron-store` (JSON files) and OS keychain. No database setup is needed.
- **AI Provider keys**: Actual AI chat requires at least one provider API key configured via Settings > AI Providers. The app is fully navigable and testable without keys.
- **Token usage history implementation**: Dashboard token usage history is not parsed from console logs. It reads OpenClaw session transcript `.jsonl` files under the local OpenClaw config directory, extracts assistant messages with `message.usage`, and aggregates fields such as input/output/cache/total tokens and cost from those structured records.

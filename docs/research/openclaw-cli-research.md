# OpenClaw CLI Deep Research

> Research conducted 2026-02-27 against `openclaw/openclaw` repository on GitHub.
> Current version: **2026.2.26** (tag `v2026.2.26`).

---

## 1. Repository Structure (Top-Level)

```
.agent/        .agents/       .github/       .pi/           .vscode/
Swabble/       apps/          assets/        changelog/     docs/
extensions/    git-hooks/     packages/      patches/       scripts/
skills/        src/           test/          ui/            vendor/

Key files:
  openclaw.mjs          ← CLI entry point (bin)
  package.json          ← Package metadata, `bin` field, dependencies
  pnpm-workspace.yaml   ← Monorepo workspace config
  pnpm-lock.yaml        ← Lockfile
  tsconfig.json         ← TypeScript config
  tsdown.config.ts      ← Build config (tsdown bundler)
  vitest.*.config.ts    ← Multiple test configs (unit, e2e, live, gateway, extensions)
  appcast.xml           ← Sparkle update feed for macOS native app
  Dockerfile*           ← Docker/sandbox images
  fly.toml              ← Fly.io deployment
  render.yaml           ← Render deployment
```

### Source Layout (`src/`)

```
src/cli/         ← CLI command registration, argument parsing, completions
src/commands/    ← Command implementations (onboard, doctor, update, uninstall, etc.)
src/infra/       ← Infrastructure: update-check, update-runner, update-global, env, etc.
src/daemon/      ← Service management (launchd, systemd, schtasks)
src/gateway/     ← Gateway server implementation
src/channels/    ← Messaging channel integrations (WhatsApp, Telegram, Slack, etc.)
src/wizard/      ← Onboarding wizard
src/config/      ← Configuration management
src/version.ts   ← Version resolution
src/entry.ts     ← Real entry point (imported by openclaw.mjs)
src/runtime.ts   ← Runtime environment (log, error, exit)
```

---

## 2. package.json Analysis

### Identity & Version

```json
{
  "name": "openclaw",
  "version": "2026.2.26",
  "type": "module",
  "main": "dist/index.js",
  "engines": { "node": ">=22.12.0" },
  "packageManager": "pnpm@10.23.0"
}
```

### CLI Entry Point (`bin` field)

```json
{
  "bin": {
    "openclaw": "openclaw.mjs"
  }
}
```

When installed globally (`npm i -g openclaw`), the system creates a symlink `openclaw` → `openclaw.mjs`.

### Exports

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./plugin-sdk": { "types": "...", "default": "./dist/plugin-sdk/index.js" },
    "./plugin-sdk/account-id": { ... },
    "./cli-entry": "./openclaw.mjs"
  }
}
```

The `./cli-entry` export allows external packages (like ClawX) to import the CLI entry point directly.

### `files` (Published to npm)

```json
{
  "files": [
    "CHANGELOG.md", "LICENSE", "openclaw.mjs", "README-header.png",
    "README.md", "assets/", "dist/", "docs/", "extensions/", "skills/"
  ]
}
```

### Key Dependencies

| Category | Notable |
|----------|---------|
| CLI framework | `commander` |
| Interactive prompts | `@clack/prompts` |
| Agent runtime | `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui` |
| Messaging | `grammy` (Telegram), `@slack/bolt`, `@buape/carbon` (Discord), `@whiskeysockets/baileys` (WhatsApp), `@line/bot-sdk` |
| Process management | `@lydell/node-pty` |
| Web/HTTP | `express@5`, `undici`, `ws` |
| Browser automation | `playwright-core` |

---

## 3. CLI Entry Point: `openclaw.mjs`

The file is a thin Node.js launcher:

```js
#!/usr/bin/env node

import module from "node:module";

// Enable V8 compile cache for faster startup
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try { module.enableCompileCache(); } catch {}
}

// Try to load warning filter from built output
await installProcessWarningFilter();

// Try to import the built entry point
if (await tryImport("./dist/entry.js")) {
  // OK
} else if (await tryImport("./dist/entry.mjs")) {
  // OK
} else {
  throw new Error("openclaw: missing dist/entry.(m)js (build output).");
}
```

**Key insight**: `openclaw.mjs` only works when `dist/` exists (i.e., the package has been built). It does NOT run TypeScript directly — it requires `dist/entry.js`.

### `src/entry.ts` (Real Entry)

The real entry point:

1. Checks if it's the **main module** (prevents double-execution when imported as a dependency)
2. Sets `process.title = "openclaw"`
3. Installs warning filters
4. Normalizes environment variables
5. **Respawn logic**: If `ExperimentalWarning` suppression flag is missing, it **respawns itself** as a child process with `--disable-warning=ExperimentalWarning` added to Node flags
6. Parses CLI profile (`--profile` flag, e.g., `dev`)
7. Imports `./cli/run-main.js` and calls `runCli(process.argv)`

**Respawn prevention**: Environment variable `OPENCLAW_NO_RESPAWN=1` or `OPENCLAW_NODE_OPTIONS_READY=1` prevents the respawn.

---

## 4. Update Mechanism

### 4.1 The `openclaw update` Command

**File**: `src/cli/update-cli.ts` → `src/cli/update-cli/update-command.ts`

The update command supports three installation modes and three update channels:

**Installation Modes**:
- **Git checkout** (`installKind === "git"`): Detected via `.git` directory at the package root
- **Package manager** (`installKind === "package"`): npm/pnpm/bun global install
- **Unknown**: Fallback

**Update Channels** (`src/infra/update-channels.ts`):
- `stable` → npm tag `latest` (default for package installs)
- `beta` → npm tag `beta`
- `dev` → npm tag `dev` / git `main` branch (default for git installs)

**CLI Options**:
```
openclaw update                            # Update (auto-detects mode)
openclaw update --channel stable|beta|dev  # Switch channel (persists to config)
openclaw update --tag <dist-tag|version>   # One-off npm update to specific tag
openclaw update --dry-run                  # Preview actions without changes
openclaw update --no-restart               # Skip gateway service restart
openclaw update --yes                      # Non-interactive
openclaw update --json                     # JSON output
openclaw update --timeout <seconds>        # Custom timeout
openclaw update wizard                     # Interactive update wizard
openclaw update status                     # Show channel + version status
```

### 4.2 Update Flow for Package Manager Installs

**File**: `src/cli/update-cli/update-command.ts` → `runPackageInstallUpdate()`

1. **Detect global package manager**: `resolveGlobalManager()` → checks npm/pnpm/bun by looking at where the current install lives
2. **Resolve global package root**: `resolveGlobalPackageRoot()` → e.g., `/usr/lib/node_modules/openclaw`
3. **Clean up stale rename dirs**: `cleanupGlobalRenameDirs()` → removes `.openclaw-*` temp dirs
4. **Run global install**: `globalInstallArgs()` generates the right command:
   - npm: `npm i -g openclaw@<tag> --no-fund --no-audit --loglevel=error`
   - pnpm: `pnpm add -g openclaw@<tag>`
   - bun: `bun add -g openclaw@<tag>`
5. **Run doctor**: `openclaw doctor` post-update
6. **Sync plugins**: `updateNpmInstalledPlugins()` + `syncPluginsForUpdateChannel()`
7. **Shell completion**: Refresh completion cache
8. **Restart gateway service**: If service is loaded, restart it

### 4.3 Update Flow for Git Checkouts

**File**: `src/infra/update-runner.ts` → `runGatewayUpdate()`

1. Detect git root and current branch/tag/SHA
2. Check for dirty working directory (skip if uncommitted changes)
3. `git fetch --prune`
4. `git rebase` (on the tracked branch)
5. `pnpm install` (or detected package manager)
6. `pnpm build`
7. `pnpm ui:build`
8. `openclaw doctor`

### 4.4 Auto-Update on Gateway Startup

**File**: `src/infra/update-startup.ts`

The gateway runs a **background update check** on startup and periodically:

```typescript
export function scheduleGatewayUpdateCheck(params) {
  // Runs on startup, then on an interval
  // Check interval: 24h (default), 1h (auto-update stable), configurable for beta
}
```

**Auto-update** (opt-in via config `update.auto.enabled: true`):

- Checks npm registry for newer version
- For `stable`: applies a configurable delay (`stableDelayHours`, default 6h) + jitter (default 12h window) — a staged rollout mechanism
- For `beta`: checks every `betaCheckIntervalHours` (default 1h)
- Runs `openclaw update --yes --channel <channel> --json` as a child process
- State persisted to `~/.openclaw/update-check.json`

### 4.5 Channel Switching

```
openclaw update --channel dev     # switches from package to git checkout if needed
openclaw update --channel stable  # switches from git to package manager if needed
```

Dev channel triggers a git clone of `https://github.com/openclaw/openclaw.git` into `OPENCLAW_GIT_DIR` (default: `~/.openclaw/` state dir).

### 4.6 Version Checking

**File**: `src/infra/update-check.ts`

```typescript
export async function checkUpdateStatus(params): Promise<UpdateCheckResult> {
  // Returns: root, installKind, packageManager, git status, deps status, registry status
}

export async function fetchNpmTagVersion(params): Promise<NpmTagStatus> {
  // Fetches https://registry.npmjs.org/openclaw/<tag>
}
```

**File**: `src/version.ts`

```typescript
export const VERSION =
  (typeof __OPENCLAW_VERSION__ === "string" && __OPENCLAW_VERSION__) ||  // build-time define
  process.env.OPENCLAW_BUNDLED_VERSION ||                                // env override
  resolveVersionFromModuleUrl(import.meta.url) ||                        // package.json
  "0.0.0";
```

---

## 5. Uninstall/Delete Mechanism

**File**: `src/commands/uninstall.ts`

The `openclaw uninstall` command provides **scoped uninstallation**:

### Scopes

| Scope | What it removes | Default |
|-------|----------------|---------|
| `service` | Gateway daemon (launchd/systemd/schtasks) | ✓ selected |
| `state` | `~/.openclaw` (config + state) | ✓ selected |
| `workspace` | Agent workspace directories | ✓ selected |
| `app` | `/Applications/OpenClaw.app` (macOS only) | ✗ not selected |

### Usage

```bash
openclaw uninstall                  # Interactive multi-select prompt
openclaw uninstall --all            # Remove everything
openclaw uninstall --service        # Just remove the daemon service
openclaw uninstall --state          # Just remove state/config
openclaw uninstall --workspace      # Just remove workspace dirs
openclaw uninstall --app            # Just remove macOS app
openclaw uninstall --dry-run        # Preview without removing
openclaw uninstall --yes            # Skip confirmation
```

### Key Implementation Details

1. **Service uninstall**: Calls `resolveGatewayService().stop()` then `.uninstall()` (platform-specific: launchd/systemd/schtasks)
2. **State removal**: Removes `~/.openclaw/` directory, config file, OAuth directory
3. **Workspace removal**: Removes agent workspace directories (configured in `agents.defaults.workspace` or `agents.list[].workspace`)
4. **App removal**: Removes `/Applications/OpenClaw.app` on macOS
5. **Safety check**: Refuses to remove unsafe paths (root, home directory)
6. **CLI itself NOT removed**: The final message says `"CLI still installed. Remove via npm/pnpm if desired."`

### Cleanup Utilities

**File**: `src/commands/cleanup-utils.ts`

- `removePath()`: Safe removal with dry-run support and unsafe path protection
- `removeStateAndLinkedPaths()`: Handles config/oauth dirs that may be symlinked outside state dir
- `removeWorkspaceDirs()`: Iterates configured workspace directories
- `collectWorkspaceDirs()`: Resolves workspace dirs from config (agents.defaults.workspace + agents.list[].workspace)

---

## 6. How the CLI Manages Its Own Installation

### 6.1 Primary Installation Method: npm Global Install

```bash
npm install -g openclaw@latest
# or: pnpm add -g openclaw@latest
```

This is the **recommended** method per the README. Creates the `openclaw` binary in the global npm bin path.

### 6.2 From Source (Development)

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build
pnpm ui:build
pnpm openclaw onboard --install-daemon
```

### 6.3 No Custom Installer Script

Unlike some CLI tools, OpenClaw does **not** have a standalone install script (no `curl | sh` installer). Installation is entirely through npm/pnpm/bun package managers or git clone.

### 6.4 npx Support

Not explicitly mentioned, but since it's a standard npm package with a `bin` field, `npx openclaw` would work for one-off execution.

### 6.5 Nix Support

There's a separate Nix flake: `github:openclaw/nix-openclaw`. When running in Nix mode (`isNixMode`), service uninstall is disabled and auto-update checks are skipped.

### 6.6 Docker Support

Dockerfiles are included (`Dockerfile`, `Dockerfile.sandbox`, etc.) for containerized deployments.

### 6.7 Daemon Installation

The `openclaw onboard --install-daemon` (or `openclaw gateway install`) sets up a system service:

| Platform | Service Type | Implementation |
|----------|-------------|----------------|
| macOS | LaunchAgent | `src/daemon/launchd.ts` — plist in `~/Library/LaunchAgents/ai.openclaw.gateway.plist` |
| Linux | systemd user service | `src/daemon/systemd.ts` |
| Windows | Scheduled Task | `src/daemon/schtasks.ts` |

### 6.8 Global Package Manager Detection

**File**: `src/infra/update-global.ts`

The CLI auto-detects which package manager was used for global install:

```typescript
export async function detectGlobalInstallManagerForRoot(runCommand, pkgRoot, timeoutMs) {
  // Check npm root -g, pnpm root -g, bun global root
  // Match against the current package root path
}

export async function detectGlobalInstallManagerByPresence(runCommand, timeoutMs) {
  // Check if openclaw exists in any global root
}
```

---

## 7. README Installation Instructions

### Recommended Install

```bash
npm install -g openclaw@latest
# or: pnpm add -g openclaw@latest

openclaw onboard --install-daemon
```

### From Source

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm ui:build   # auto-installs UI deps on first run
pnpm build
pnpm openclaw onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

### Update Channels

```
stable  ← tagged releases (vYYYY.M.D), npm dist-tag `latest`
beta    ← prerelease tags (vYYYY.M.D-beta.N), npm dist-tag `beta`
dev     ← moving head of `main`, npm dist-tag `dev`
```

Switch: `openclaw update --channel stable|beta|dev`

---

## 8. Standalone CLI vs Embedded in Electron (ELECTRON_RUN_AS_NODE)

### Key Finding: No Detection in OpenClaw CLI Itself

The `openclaw/openclaw` repository has **zero references** to `ELECTRON_RUN_AS_NODE`. The CLI does not know or care whether it's running under Electron. It treats all Node.js-compatible runtimes the same way.

### How ClawX (Electron App) Embeds OpenClaw

The Electron integration is entirely on the **ClawX side** (this workspace). Here's how it works:

#### Package Location

**File**: `electron/utils/paths.ts`

```typescript
export function getOpenClawDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'openclaw');  // bundled in app resources
  }
  return join(__dirname, '../../node_modules/openclaw');  // from node_modules in dev
}

export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}
```

- **Production (packaged)**: OpenClaw is bundled at `<App>.app/Contents/Resources/openclaw/`
- **Development**: Uses `node_modules/openclaw` (the npm dependency)

#### Gateway Process Spawning

**File**: `electron/gateway/manager.ts`

Three modes of starting the gateway:

```typescript
if (app.isPackaged) {
  // Mode: "packaged"
  command = getNodeExecutablePath();  // Electron Helper binary (avoids dock icon on macOS)
  args = [entryScript, ...gatewayArgs];
  // Environment: ELECTRON_RUN_AS_NODE=1, OPENCLAW_NO_RESPAWN=1
} else if (isOpenClawBuilt() && existsSync(entryScript)) {
  // Mode: "dev-built"
  command = 'node';
  args = [entryScript, ...gatewayArgs];
} else {
  // Mode: "dev-pnpm"
  command = 'pnpm';
  args = ['run', 'dev', ...gatewayArgs];
}
```

**Critical environment variables set in packaged mode**:
- `ELECTRON_RUN_AS_NODE=1` — makes Electron binary behave as plain Node.js
- `OPENCLAW_NO_RESPAWN=1` — prevents the entry.ts respawn logic (would create extra processes/dock icons)
- `NODE_OPTIONS=--disable-warning=ExperimentalWarning` — pre-set what the respawn would have added

#### macOS Dock Icon Avoidance

```typescript
function getNodeExecutablePath(): string {
  if (process.platform === 'darwin' && app.isPackaged) {
    // Use Electron Helper binary which has LSUIElement=true in Info.plist
    // Prevents a second dock icon appearing
    const helperPath = path.join(
      path.dirname(process.execPath),
      '../Frameworks',
      `${appName} Helper.app/Contents/MacOS/${appName} Helper`,
    );
    if (existsSync(helperPath)) return helperPath;
  }
  return process.execPath;
}
```

#### CLI Wrapper Script Installation (macOS)

**File**: `electron/utils/openclaw-cli.ts`

ClawX can install a shell wrapper at `~/.local/bin/openclaw`:

```bash
#!/bin/sh
ELECTRON_RUN_AS_NODE=1 "/path/to/ClawX.app/.../ClawX" "/path/to/openclaw.mjs" "$@"
```

This allows users to use `openclaw` from the terminal while the actual runtime is the Electron binary.

#### CLI Command Resolution Order

```typescript
export function getOpenClawCliCommand(): string {
  // 1. macOS: check ~/.local/bin/openclaw (installed wrapper)
  // 2. Development (unpackaged): check node_modules/.bin/openclaw
  // 3. Packaged: ELECTRON_RUN_AS_NODE=1 <execPath> <entryPath>
  // 4. Development fallback: node <entryPath>
}
```

---

## 9. Releases & Tags

### Recent Releases

| Tag | Date | Type |
|-----|------|------|
| `v2026.2.26` | 2026-02-27 | Stable |
| `v2026.2.26-beta.1` | 2026-02-26 | Beta |
| `v2026.2.25` | 2026-02-26 | Stable |
| `v2026.2.25-beta.1` | 2026-02-26 | Beta |
| `v2026.2.24` | 2026-02-25 | Stable |

### Release Assets

Releases ship **macOS native app** assets:
- `OpenClaw-YYYY.M.DD.dmg` — macOS disk image
- `OpenClaw-YYYY.M.DD.zip` — macOS zip archive
- `OpenClaw-YYYY.M.DD.dSYM.zip` — macOS debug symbols

The macOS app uses Sparkle for auto-updates (`appcast.xml`).

### Versioning Scheme

Calendar-based: `YYYY.M.DD` (e.g., `2026.2.26`). Beta versions append `-beta.N`.

---

## 10. Summary of Key Architectural Patterns

### CLI → Gateway Lifecycle

```
openclaw.mjs
  ↓ imports
dist/entry.js (built from src/entry.ts)
  ↓ respawn (adds --disable-warning flag)
entry.ts (respawned child)
  ↓ imports
src/cli/run-main.ts → buildProgram() → commander-based CLI
  ↓ routes to
src/commands/* (gateway, agent, update, doctor, uninstall, etc.)
```

### Update Architecture

```
┌─────────────────────────────────────────┐
│         openclaw update                  │
│                                          │
│  1. Detect install kind (git/package)    │
│  2. Detect package manager (npm/pnpm/bun)│
│  3. Resolve channel (stable/beta/dev)    │
│  4. Check for downgrades                 │
│  5a. Git: fetch/rebase/build/doctor      │
│  5b. Package: npm/pnpm/bun add -g       │
│  6. Sync plugins                         │
│  7. Refresh shell completions            │
│  8. Restart gateway service              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│    Auto-update (gateway startup)         │
│                                          │
│  Config: update.auto.enabled = true      │
│  - Checks npm registry periodically      │
│  - Stable: 6h delay + 12h jitter        │
│  - Beta: checks every 1h                │
│  - Runs: openclaw update --yes --json    │
│  - State: ~/.openclaw/update-check.json  │
└─────────────────────────────────────────┘
```

### Electron Embedding Architecture

```
┌──────────────────────────────────────────────────┐
│  ClawX (Electron App)                             │
│                                                    │
│  electron/gateway/manager.ts                       │
│    ↓ spawns child process                          │
│  ELECTRON_RUN_AS_NODE=1 <Helper> openclaw.mjs      │
│  OPENCLAW_NO_RESPAWN=1                             │
│    ↓                                               │
│  openclaw.mjs → dist/entry.js                      │
│    ↓ (respawn skipped due to OPENCLAW_NO_RESPAWN)  │
│  run-main.ts → gateway command                     │
│    ↓                                               │
│  Gateway process on port 18789                     │
│    ↕ WebSocket                                     │
│  ClawX UI (React/Vite)                             │
└──────────────────────────────────────────────────┘

Packaged app directory layout:
  ClawX.app/
    Contents/
      MacOS/ClawX                           ← Electron main binary
      Frameworks/ClawX Helper.app/          ← Used for ELECTRON_RUN_AS_NODE
      Resources/
        openclaw/                           ← Bundled openclaw package
          openclaw.mjs                      ← CLI entry
          dist/                             ← Built JS output
          package.json
          ...
```

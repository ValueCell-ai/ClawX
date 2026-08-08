# ClawX Development Guide

This document provides the detailed version of the Development section in the README.

### Prerequisites

- **Node.js**: 22.22.3+, 24.15.0+, or 25.9.0+ within the corresponding supported major line (Node 24 LTS recommended)
- **Package Manager**: pnpm 9+ (npm is also supported)
- **Linux (Ubuntu/Debian)**: Install the required system libraries before running Electron:
  ```bash
  sudo apt-get install -y libnss3 libgtk-3-0 libxss1 libxtst6 libatspi2.0-0 libnotify4 xdg-utils
  ```
  On Ubuntu 24.04+, some packages use a `t64` suffix; `apt` automatically selects the correct variant when you run the command above.

### Project Structure

```text
ClawX/
├── electron/                 # Electron Main Process
│   ├── services/            # Typed Host API, provider, secrets, and runtime services
│   │   ├── providers/       # Provider/account model sync logic
│   │   └── secrets/         # OS keychain and secret storage
│   ├── shared/              # Shared provider schemas/constants
│   │   └── providers/
│   ├── main/                # App entry, windows, and IPC registration
│   ├── gateway/             # OpenClaw Gateway process manager
│   ├── preload/             # Secure IPC bridge
│   └── utils/               # Utilities for storage, auth, and paths
├── src/                      # React Renderer Process
│   ├── lib/                 # Unified frontend API and error model
│   ├── stores/              # Zustand stores (settings/chat/gateway)
│   ├── components/          # Reusable UI components
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # Localization resources
│   └── types/               # TypeScript type definitions
├── tests/
│   ├── e2e/                 # Playwright Electron end-to-end smoke tests
│   └── unit/                # Vitest unit and integration-like tests
├── resources/                # Static assets (icons and images)
└── scripts/                  # Build and utility scripts
```

### Available Commands

```bash
# Development
pnpm run init             # Install dependencies and download bundled binaries (uv, agent-browser)
pnpm dev                  # Start with hot reload (auto-prepares bundled skills if missing)

# Quality
pnpm lint                 # Run ESLint
pnpm typecheck            # TypeScript validation

# Testing
pnpm test                 # Run unit tests
pnpm run test:e2e         # Run Electron E2E smoke tests
pnpm run test:e2e:headed  # Run Electron E2E tests with a visible window
pnpm run perf:chat        # Capture synthetic Chat Renderer/Main CPU profiles
pnpm run profile:main     # Launch the built app with Main inspector on port 9229
pnpm run comms:replay     # Compute communication replay metrics
pnpm run comms:baseline   # Refresh the communication baseline snapshot
pnpm run comms:compare    # Compare replay metrics against baseline thresholds

# Build and Package
pnpm run build:vite       # Build the frontend only
pnpm build                # Full production build with packaging assets
pnpm package              # Package for the current platform with bundled skills
pnpm package:mac          # Package for macOS
pnpm package:win          # Package for Windows
pnpm package:linux        # Package for Linux
```

On headless Linux, Electron tests need a display service. Use `xvfb-run -a pnpm run test:e2e`.

Electron E2E functional tests use two Playwright workers by default both locally and in CI. Set `CLAWX_E2E_WORKERS=<positive integer>` to tune the ordinary parallel lane for the machine. Tests that touch OS-global state use the one-worker `exclusive` project, and host performance profiles run alone afterward. New E2E tests are parallel by default; apply `E2E_EXCLUSIVE_TAG` from `tests/e2e/parallel-policy.ts` when a test uses the real clipboard or another machine-global resource.

For a focused ordinary spec that does not need the exclusive prerequisite, run `pnpm exec playwright test <spec> --project=parallel --no-deps`.

### Electron Performance Diagnostics

`pnpm run perf:chat` runs isolated synthetic ACP workloads for streaming and for rich static Markdown sidebar and scroll interaction. It writes versioned metrics plus Renderer and Main CPU profiles under the Playwright `test-results/` directory. Renderer profiles cover the production store/render path and frame pacing. The streaming Main profile measures Main-to-Renderer IPC fanout, while the interaction Main profile shows whether Main remains idle while Renderer interactions run. Neither includes the upstream OpenClaw/ACP subprocess or GPU-process paths.

Open a CPU profile in Chrome DevTools. The artifacts contain generated fixture text only and are not product telemetry. Results are hardware-dependent, so compare repeated runs on the same machine instead of applying one cross-platform absolute threshold.

For a live Renderer recording, start development with `CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev` and attach Playwright or Chrome DevTools to `localhost:9223`. For a live Electron Main recording, run `pnpm run profile:main`, open `chrome://inspect`, configure `localhost:9229`, and select the Electron Main target. Leave `CLAWX_GATEWAY_WS_TRACE` unset unless WebSocket tracing itself is being measured.

ClawX leaves Chromium hardware acceleration enabled by default so long documents, scrolling, and layout animations can use GPU compositing and rasterization. Chromium still honors the native `--disable-gpu` command-line switch as a troubleshooting fallback for a machine with a broken graphics driver.

### Communication Regression Checks

When a PR changes communication paths such as Gateway events, the ACP Chat bridge send/receive flow, channel delivery, or transport fallback, run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

The `comms-regression` CI job enforces required scenarios and threshold checks.

### Electron E2E Tests

The Playwright Electron suite launches the packaged renderer and Main process from `dist/` and `dist-electron/`, so it does not require manually running `pnpm dev` first.

`pnpm run test:e2e` automatically:

- builds the renderer and Electron bundles with `pnpm run build:vite`
- starts Electron in an isolated E2E mode with a temporary `HOME`
- uses a temporary ClawX `userData` directory
- runs ordinary spec files concurrently while fencing OS-global and performance tests
- skips heavy startup side effects such as Gateway auto-start, bundled skill installation, tray creation, and CLI auto-install

The first baseline specs cover:

- first-launch Setup Wizard visibility on a fresh profile
- skipping setup and navigating to the Models page inside the Electron app

Add future Electron flows under `tests/e2e/` and reuse the shared fixture in `tests/e2e/fixtures/electron.ts`. Keep tests parallel-safe by avoiding fixed writable paths, ports, native keychains, and other external shared state. Use `E2E_EXCLUSIVE_TAG` when isolation is not possible.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 40+ |
| UI Framework | React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Build | Vite + electron-builder |
| Testing | Vitest + Playwright |
| Animation | Framer Motion |
| Icons | Lucide React |

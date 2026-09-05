---
id: local-computer-use
title: Host-owned local Computer Use
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose a local-only computer tool on macOS and Windows by having Electron Main own the embedded CUA daemon and a ClawX plugin connect to it without OpenClaw node pairing.
touchedAreas:
  - harness/specs/tasks/local-computer-use.md
  - harness/specs/rules/local-computer-use.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/main/index.ts
  - electron/gateway/config-sync-env.ts
  - electron/gateway/config-sync.ts
  - electron/utils/cua-runtime.ts
  - electron/utils/cua-platform.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/plugin-install.ts
  - resources/openclaw-plugins/clawx-cua-computer/**
  - scripts/download-cua-driver.mjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - tests/unit/cua-runtime.test.ts
  - tests/unit/cua-driver-artifacts.test.ts
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/clawx-cua-plugin.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - On macOS and Windows, local agent runs receive a computer tool without running an OpenClaw node host or approving a node pairing request.
  - The computer tool can capture the primary display and perform clicks, pointer movement, drag, scroll, text input, key chords, and bounded waits.
  - macOS attributes Accessibility and Screen Recording permission requests to ClawX; the CUA daemon never appears as a separately permissioned app.
  - Missing permissions, missing binaries, malformed runtime descriptors, and crashed proxies fail with an actionable COMPUTER_DRIVER_UNAVAILABLE error instead of crashing ClawX or Gateway.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cua-runtime.test.ts
  - tests/unit/cua-driver-artifacts.test.ts
  - tests/unit/clawx-cua-plugin.test.ts
  - tests/unit/gateway-process-launcher.test.ts
acceptance:
  - Electron Main starts the bundled cua-driver executable as a direct child through @trycua/cua-driver EmbeddedCuaDriverHost and stops it after Gateway during orderly quit.
  - Main publishes only a generation-scoped MCP launch descriptor in the ClawX user-data directory; the plugin never starts the privileged serve daemon.
  - The bundled plugin registers a non-optional computer tool against OpenClaw 2026.7.1-2 and reads the descriptor path from CLAWX_CUA_CONNECTION_FILE.
  - Computer actions are serialized, coordinate actions require a prior screenshot, MCP errors are bounded and normalized, and every successful action returns a follow-up primary-display screenshot when capture succeeds.
  - The plugin and daemon are enabled locally without adding gateway.nodes allowCommands, node.invoke policies, node-host startup, pairing, remote node discovery, or renderer-owned backend transport.
  - CUA release downloads are version-pinned and SHA256-verified for macOS universal and Windows x64 assets.
  - Packaged native SDK libraries are outside ASAR where required and the cua-driver executable is included in each supported macOS/Windows package.
docs:
  required: true
---

# Local Computer Use

ClawX owns one local CUA daemon generation. Electron Main is the daemon's direct
parent so macOS grants belong to the signed ClawX application. The OpenClaw
Gateway receives only the path of a private connection descriptor; the
ClawX-owned plugin starts the unprivileged MCP stdio proxy described by that
file and exposes the model-facing `computer` tool.

Remote hosts and OpenClaw node pairing are intentionally outside this feature.

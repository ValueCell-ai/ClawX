---
id: local-computer-use
title: Host-owned local Computer Use
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Retain Main-owned local CUA lifecycle on macOS and Windows while native CLI integration supersedes the original plugin transport.
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
  - resources/skills/computer-use/**
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
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - After explicit opt-in on macOS and Windows, local agents use existing exec/read with the native bundled CLI, without an OpenClaw node host or pairing request.
  - Native window, AX element, menu, and verification operations are available alongside primary-display capture and input, not a ClawX action subset.
  - Main owns macOS permission requests; the OS-listed responsible application may be ClawX or a development terminal/IDE, and attribution needs packaged validation.
  - Missing permissions, binaries, invalid descriptors, and unavailable endpoints are reported without crashing ClawX/Gateway, bypassing opt-in, or launching another daemon.
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
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/gateway-process-launcher.test.ts
acceptance:
  - After explicit opt-in, Electron Main starts the bundled cua-driver executable as a direct child through @trycua/cua-driver EmbeddedCuaDriverHost and stops it concurrently with Gateway during orderly quit.
  - Main atomically publishes the private v 2 descriptor with generation, driverVersion, binaryPath, and socketPath in ClawX user data; existing exec uses the absolute bundled binary and explicit endpoint.
  - The computer-use Skill reads CLAWX_CUA_CONNECTION_FILE; no ClawX computer tool, OpenClaw plugin, MCP proxy, or action wrapper is registered.
  - CLI workflows use named sessions, bounded observations, semantic result verification, and image-capable read; unknown-completion input is not blindly replayed and no global serialization or native cancellation guarantee is claimed.
  - The daemon is enabled only after explicit local opt-in, without adding gateway.nodes allowCommands, node.invoke policies, node-host startup, pairing, remote node discovery, or renderer-owned backend transport.
  - CUA release downloads are version-pinned and SHA256-verified for macOS universal and Windows x64 assets.
  - Packaged native SDK libraries are outside ASAR where required and the cua-driver executable is included in each supported macOS/Windows package.
docs:
  required: true
---

# Local Computer Use

The original internal plugin/MCP task is superseded by
`harness/specs/tasks/cua-driver-cli.md` for model-facing operations. Its old
`computer` registration, MCP descriptor, action serialization, automatic
follow-up screenshots, and plugin test requirement are historical, not executable
acceptance. The requirements above retain the applicable lifecycle/packaging
contract and use current CLI coverage instead of the removed adapter suite.

`harness/specs/tasks/cua-025-upgrade.md` now owns the SDK/driver/official Skill
0.25.0 pin and safe upgrade of untouched known 0.21.0 Skill files. Both Main daemon
options and Gateway CLI children disable telemetry using the supported SDK
allowlist; retain the Windows PE patch. Earlier 0.21.0 validation remains
historical and does not establish rebuilt 0.25.0 behavior.

ClawX still owns one local CUA daemon generation through Electron Main. The
Gateway receives the private descriptor path; existing exec/read operations use
that Main-owned endpoint. SDK/ASAR facts and permission attribution limits are in
`harness/reference/computer-use.md`.

Remote hosts and OpenClaw node pairing are intentionally outside this feature.

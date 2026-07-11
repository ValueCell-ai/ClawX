---
id: runtime-abstraction-cc-connect
title: Make cc-connect a usable ClawX replacement runtime
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep OpenClaw as the default and rollback runtime while making cc-connect plus Codex satisfy ClawX core workflows through one runtime contract.
touchedAreas:
  - .env.cc-connect.local.example
  - .github/workflows/**
  - README*.md
  - docs/**
  - harness/src/**
  - harness/specs/**
  - electron/extensions/**
  - electron/runtime/**
  - electron/services/**
  - electron/main/**
  - electron/shared/**
  - electron/utils/**
  - shared/**
  - src/**
  - scripts/**
  - tests/**
  - package.json
  - pnpm-lock.yaml
  - electron-builder.yml
expectedUserBehavior:
  - OpenClaw remains selected by default and can be restored without deleting cc-connect data.
  - cc-connect remains behind Developer Mode but can run real GUI chat without any direct ClawX-to-Codex path.
  - Stable, beta, dev, and multiple installations share upgrade-stable data under ~/.clawx with one active writer.
  - Existing OpenClaw workspaces are reused by reference; new Agents receive managed ~/.clawx workspaces.
  - Different Agents can bind different OAuth or API-key accounts without credential, session, workspace, or usage crossover.
  - Each Agent can independently select cc-connect `full-auto` or approval-required `suggest` mode; the latter has real OAuth GUI approval evidence.
  - Sessions and history use cc-connect public APIs; tools and approval responses use public Bridge events/`card_action`; per-run cancellation and usage remain explicit replacement blockers until cc-connect exposes public APIs/events.
  - Feishu/Lark messages reach the bound Agent through cc-connect and replies return through cc-connect.
  - GUI and Channel /cron manage the same native cron-expression jobs.
  - Skills are shared across runtimes and a real skill can be invoked in cc-connect chat.
  - cc-connect Doctor, health, stdout/stderr, runtime events, and diagnostics are visible without leaking secrets.
  - Packaged applications contain verified cc-connect and Codex binaries and run without runtime downloads.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/runtime-manager.test.ts
  - tests/unit/cc-connect-runtime-provider.test.ts
  - tests/unit/cc-connect-bridge-adapter.test.ts
  - tests/unit/cc-connect-provider-profile.test.ts
  - tests/unit/cc-connect-bundle.test.ts
  - tests/unit/runtime-packaging.test.ts
  - tests/unit/packaged-cc-connect-smoke.test.ts
  - tests/unit/cc-connect-paths.test.ts
  - tests/unit/token-usage.test.ts
  - tests/unit/token-usage-scan.test.ts
  - tests/e2e/cc-connect-codex-runtime.spec.ts
  - tests/e2e/cc-connect-real-bundle-smoke.spec.ts
  - tests/e2e/cc-connect-real-comprehensive.spec.ts
  - tests/e2e/cc-connect-real-openai-api-key.spec.ts
  - tests/e2e/cc-connect-real-feishu-channel.spec.ts
  - tests/e2e/cc-connect-real-scheduled-cron.spec.ts
acceptance:
  - The dependency and bundled binary are pinned to the same verified stable cc-connect version.
  - electron-builder `afterPack` verifies copied cc-connect and Codex resources for the target architecture; final macOS x64/arm64, Windows x64, and Linux x64/arm64 unpacked resources pass the packaged-resource verifier, including signed Mach-O section and code-signature validation where whole-file SHA changes.
  - Release publishing depends on native packaged smoke for macOS x64/arm64, Windows x64, and Linux x64/arm64. Each smoke launches the packaged Electron app, starts cc-connect through Host API, checks managed runtime state plus Cron and Doctor, rolls back to OpenClaw, and proves PID/ports/runtime-directory processes are cleaned.
  - No cc-connect runtime code launches Codex for chat or uses Codex transcript polling as a production event/history/usage path.
  - No cc-connect runtime code writes OpenClaw config or cc-connect private session stores.
  - Canonical Agent/channel saves in cc-connect mode update only the ClawX runtime config and encrypted vault; OpenClaw start/restart explicitly rebuilds the compatibility projection before Gateway startup, and a newer projection never overrides existing canonical state by mtime.
  - Host API calls are routed through RuntimeManager and the active RuntimeProvider.
  - Runtime events carry stable event/run/turn/session/project sequencing and survive Bridge reconnect without duplication.
  - The cc-connect Bridge adapter sends the protocol-compatible 25-second client ping, reconnects after an unexpected disconnect, and never reconnects after an intentional runtime stop.
  - Account-level OAuth homes and encrypted API keys are isolated per Provider Account.
  - cc-connect project work_dir always resolves from the Agent workspace registry and never from process.cwd or the source checkout.
  - Native cron-expression jobs and manual run are shared between GUI and Channel; at/every remain capability-aware and non-mutating because cc-connect v1.4.1 does not expose equivalent schedule kinds.
  - Pinned cc-connect Bridge capabilities match its public protocol; ClawX opts into progress-card payloads and maps only events emitted by cc-connect, with an explicitly marked terminal inference when a final reply closes a tool lacking a result entry.
  - Token usage maps public runtime payloads without double-counting cached input or reasoning output; absent cc-connect counters produce explicit `missing` turn records and never transcript-derived estimates.
  - Real OAuth, real external API-key, Feishu inbound/reply, native Channel Cron, Doctor, workspace, and packaged evidence paths are recorded in a sanitized report.
  - pnpm harness validate --spec harness/specs/tasks/runtime-abstraction-cc-connect.md passes.
  - pnpm harness run --spec harness/specs/tasks/runtime-abstraction-cc-connect.md passes or records explicit external-credential/release-platform gaps without claiming replacement readiness.
docs:
  required: true
---

The implementation contract is `docs/runtime-abstraction-cc-connect.md`.
Temporary compatibility behavior must be labeled degraded and must not satisfy a
replacement-readiness row. Any direct Codex bridge, ClawX-owned prompt
scheduler, private cc-connect session-store write, or transcript-based real-time
event path is a migration target, not an accepted final implementation.

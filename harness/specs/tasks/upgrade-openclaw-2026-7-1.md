---
id: upgrade-openclaw-2026-7-1
title: Upgrade the bundled OpenClaw runtime to 2026.7.1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep ClawX runtime and bundled channel plugins aligned with OpenClaw 2026.7.1 across supported platforms.
touchedAreas:
  - .github/workflows/check.yml
  - package.json
  - pnpm-lock.yaml
  - scripts/download-bundled-node.mjs
  - scripts/bundle-openclaw.mjs
  - electron/services/acp-chat-service.ts
  - electron/services/cron-api.ts
  - src/lib/cron-session-history.ts
  - src/stores/acp-chat-session.ts
  - shared/acp-chat/types.ts
  - electron/utils/openclaw-upgrade-snapshot.ts
  - electron/utils/plugin-install-index.ts
  - electron/utils/plugin-install.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/startup-recovery.ts
  - electron/gateway/startup-orchestrator.ts
  - electron/gateway/manager.ts
  - electron/gateway/process-policy.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/gateway-process-policy.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1.md
expectedUserBehavior:
  - Existing OpenClaw 2026.6.10 configuration, authentication, sessions, and channel credentials remain usable after upgrade, with a one-time pre-migration snapshot of mutable config/auth/SQLite state.
  - ClawX reconciles old managed channel-plugin install records with its current mirrored extensions, removes records for unconfigured mirrors, and links declared `openclaw` peers to the bundled runtime before OpenClaw's post-core payload smoke check.
  - ClawX starts and communicates with the bundled OpenClaw 2026.7.1 Gateway, including migration and control-plane safe-mode startup states.
  - ClawX registers the compatibility-patched WeCom mirror as a local-path install with static channel metadata so OpenClaw startup migration does not replace it with the raw mismatched npm package.
  - Fatal runtime/SQLite incompatibility, EX_CONFIG exits, invalid migrations, and active migration leases do not enter unbounded Gateway restart loops.
  - ACP chat initializes, replays, prompts, cancels, requests permission, and forwards unknown ACP 1.1 session updates without dropping the NDJSON connection.
  - Cron sessions use OpenClaw 2026.7.1's SQLite-backed `cron.runs` history when ACP replay is empty, so immediate and scheduled executions show their prompt and completed summaries instead of an empty timeline.
  - Bundled channel plugins use versions compatible with OpenClaw 2026.7.1 while existing WeCom and Open Lark manifest-ID compatibility behavior remains unchanged.
  - Packaged builds use Electron and Windows Node runtimes that satisfy OpenClaw 2026.7.1 Node and SQLite requirements.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - OpenClaw, ACP SDK, Electron, Windows Node, and official OpenClaw channel plugins are pinned to compatible runtime versions.
  - DingTalk is pinned to 3.6.6, WeCom to 2026.7.2, and Open Lark to 2026.7.9 without changing ClawX's effective manifest-ID mappings.
  - The lockfile resolves OpenClaw and all bundled channel plugins without incompatible peers or stale 2026.6.10 plugin packages.
  - Electron embeds Node 24.15.0 or newer within the Node 24 line and a WAL-reset-safe SQLite runtime.
  - The bundled Windows Node version satisfies OpenClaw 2026.7.1's declared engine range.
  - ClawX snapshots OpenClaw config, credentials, and SQLite databases with WAL/SHM sidecars once before the first 2026.7.1 prelaunch sync.
  - ClawX writes plugin install metadata to OpenClaw 2026.7.1's canonical `state/openclaw.sqlite` index, removes legacy config records, and represents the patched WeCom and official Feishu mirrors as local paths rather than stale npm-managed installs.
  - Configured mirrored plugins that declare an `openclaw` peer have a runtime link to the current bundled OpenClaw package before migration validation; stale install records for unconfigured mirrors are removed so missing directories cannot block startup.
  - Gateway recovery performs at most one doctor repair per startup flow and does not retry fatal runtime, EX_CONFIG, invalid migration, or active migration-lease failures indefinitely.
  - Electron Main reads current cron history through Gateway `cron.runs`, retains legacy JSONL as a compatibility fallback, and supplements only empty cron ACP replay in memory without replacing non-empty replay.
  - ACP 1.1 type checks, targeted runtime tests, communication regression checks, and harness validation pass.
docs:
  required: true
---

Use this task spec for the coordinated runtime, official plugin, lockfile, and
Windows Node baseline upgrade required by OpenClaw 2026.7.1.

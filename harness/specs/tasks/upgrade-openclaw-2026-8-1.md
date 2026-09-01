---
id: upgrade-openclaw-2026-8-1
title: Upgrade the bundled OpenClaw runtime to 2026.8.1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade ClawX to OpenClaw 2026.8.1 without losing configuration, credentials, sessions, routing, or desktop features while OpenClaw moves active session and transcript state to SQLite.
touchedAreas:
  - harness/specs/tasks/upgrade-openclaw-2026-8-1.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/rules/compaction-context-progress.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - patches/openclaw@2026.7.1-2.patch
  - patches/openclaw@2026.8.1.patch
  - scripts/bundle-openclaw.mjs
  - scripts/bundle-openclaw-plugins.mjs
  - electron/gateway/**
  - electron/main/**
  - electron/services/**
  - electron/shared/providers/model-capabilities.ts
  - electron/utils/**
  - src/lib/acp/transcript-supplement.ts
  - tests/unit/**
  - tests/e2e/**
  - harness/reference/openclaw-config-delivery.md
  - harness/reference/openclaw-session-storage.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - Fresh installs and supported direct upgrades from bundled OpenClaw 2026.6.10, 2026.7.1, and 2026.7.1-2 preserve configuration, credentials, configured agents, channel accounts, routing bindings, model selection, and conversation history.
  - Before OpenClaw 2026.8.1 mutates legacy state, ClawX stops competing writers and creates a verified owner-only recovery checkpoint outside the active OpenClaw state tree.
  - ClawX completes required config, agent database, exec-approval, workspace, plugin, and all-agent session SQLite migrations before starting the Gateway.
  - Migration failure is fail-closed, preserves source data and the recovery checkpoint, and reports the failed stage instead of entering a Gateway restart loop.
  - Multi-agent upgrades retain an explicit system agent and channel/account bindings so channel ingress, heartbeat, and scheduled delivery do not silently lose their owner.
  - Active session history, rename, and deletion use OpenClaw storage-neutral Gateway contracts rather than mutating sessions.json or live JSONL files.
  - Dashboard usage history, cron replay, issue-report export, and ACP transcript supplements continue to work for both migrated sessions and new SQLite-only sessions.
  - Realtime Talk remains removed. The upgrade must not restore its UI, host contracts, Gateway bridge, or SDK dependencies; ordinary audio attachments and channel voice dependencies remain supported.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - openclaw-config-delivery
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - issue-report-export-safety
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-agent-db-repair.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-memory-search.test.ts
  - tests/unit/openclaw-image-generation.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/token-usage-files.test.ts
acceptance:
  - package.json and the lockfile resolve OpenClaw and @openclaw/ai to 2026.8.1, with compatible versions of every plugin bundled by ClawX.
  - Any local OpenClaw patch contains only ClawX-supported upgrade defects reproduced against vanilla 2026.8.1 and records its upstream source and removal condition.
  - After creating the verified snapshot, the migration preflight canonicalizes Doctor-blocking legacy keys and safely repairs known legacy agent database drift before Doctor repair; it remains resumable after interruption and does not accept a zero Doctor exit code as sufficient proof.
  - Post-migration validation confirms canonical config keys, supported agent database schemas, no blocking legacy session store, preserved session samples, and no missing or version-drifted active plugins.
  - ClawX writes agents.entries, memory.search, agents.defaults.mediaModels, canonical OpenAI routes, explicit multi-agent ownership, system-agent ownership, and preserved routing bindings without recreating retired keys.
  - ClawX does not directly mutate active sessions.json or transcript JSONL files under OpenClaw 2026.8.1.
  - Upgrade fixtures cover fresh install, supported version jumps, single and multi-agent state, interrupted retry, OpenAI/Codex routing, plugin drift, and new SQLite-only sessions.
  - Harness validation, type checks, unit tests, communication regression checks, bundle smoke, and upgrade Electron E2E pass.
  - Upgrade and downgrade boundaries are documented in all maintained README locales.
docs:
  required: true
---

OpenClaw 2026.8.1 is a storage and configuration migration, not a dependency-only
upgrade. Gateway readiness is allowed only after the offline migration receipt
records a verified pre-start state. A later live probe may complete the receipt,
but a failed probe must remain visible and must not delete rollback material.

Legacy JSONL files are migration, archive, support, and downgrade inputs only.
OpenClaw Gateway RPC and canonical SQLite state own active sessions after the
upgrade.

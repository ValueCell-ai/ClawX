---
id: fix-wechat-cron-delivery-targets
title: Read canonical session delivery metadata for scheduled WeChat targets
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore scheduled-task recipient discovery after OpenClaw moves persisted session routing into delivery.context and delivery.origin.
touchedAreas:
  - electron/services/channels-api.ts
  - electron/utils/session-util.ts
  - tests/unit/host-services.test.ts
  - tests/unit/session-util.test.ts
  - tests/e2e/cron-delivery-targets.spec.ts
  - README*.md
  - harness/**
expectedUserBehavior:
  - Existing external WeChat conversations appear under their sending account in the scheduled-task target picker.
  - Selecting a target preserves the original case-sensitive recipient ID and explicit account in the created task.
  - Canonical internal or none delivery state cannot resurrect stale external targets or accounts.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - channel-plugin-migration-guards
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/host-services.test.ts tests/unit/session-util.test.ts
  - pnpm exec playwright test tests/e2e/cron-delivery-targets.spec.ts
  - pnpm run typecheck
acceptance:
  - SQLite delivery.kind external records use delivery.context and delivery.origin; legacy JSON records remain supported.
  - A present canonical delivery record is authoritative over stale legacy fields, and SQLite remains authoritative over sessions.json.
  - Targets and account inference stay channel/account scoped, deduplicated and preserve recipient casing.
  - Electron coverage selects WeChat targets and verifies the submitted account and recipient without sending external messages.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The attached issue report shows an upgrade to 0.7.0-biz.0 / OpenClaw
2026.10.10 and successful inbound/outbound WeChat traffic while the picker is
empty. It does not contain the session index or database. The pinned runtime's
canonical delivery format reproduces the failure without private user data.

Validation on Windows:

- The SQLite target regression failed before the fix and passed afterward.
- 79 unit tests passed across host-services, session-util and cron-schedule when
  excluding the unrelated existing `reads only selected log files from the log
  directory` test. That test also fails in isolation: Windows returns `ENOENT`
  for the outside temp path instead of the expected `Invalid log file path`.
- The Electron regression passed using production target discovery against an
  isolated SQLite fixture; task creation was intercepted, with no live delivery.
- Typecheck, build:vite, changed-file ESLint, comms replay/compare, harness:ci,
  task validation and the task harness dry-run passed.
- The reporter's actual session database was not included in the bundle; live
  enterprise WeChat delivery and a packaged enterprise rebuild remain untested.

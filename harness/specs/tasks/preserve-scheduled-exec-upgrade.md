---
id: preserve-scheduled-exec-upgrade
title: Preserve scheduled exec compatibility across Gateway upgrades
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve background workers started by legacy Windows scheduled commands during direct upgrades from ClawX 0.6.1.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-*cron*.test.ts
  - electron/gateway/**
  - electron/utils/openclaw-cron*.ts
  - electron/utils/openclaw-upgrade-snapshot.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/gateway-*test.ts
  - tests/unit/cron-*test.ts
  - scripts/test*cron*.mjs
  - scripts/generate-061-cron-fixture.mjs
  - tests/fixtures/**
  - .github/workflows/check.yml
  - harness/specs/tasks/preserve-scheduled-exec-upgrade.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - README*.md
expectedUserBehavior:
  - Identify legacy launcher jobs from the verified upgrade snapshot without changing their scripts. Use one hour for an unknown worker budget and respect custom limits.
  - Keep a verified launcher's worker under supervision when its existing positive deadline already covers the worker.
  - Read jobs from the active legacy cron store when a database also contains jobs from other store paths.
  - A short Windows launcher can return before its scheduled work finishes. Observe the native Job through completion or its existing deadline.
  - Cancellation, shutdown and authorization continue to apply.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-061-cron-upgrade.test.ts
  - tests/unit/openclaw-cron-migration-manifest.test.ts
  - tests/unit/openclaw-windows-cron-descendants.test.ts
  - tests/unit/openclaw-cron-run-context.test.ts
  - node scripts/test-windows-cron-worker.mjs (Windows)
acceptance:
  - Verify the pinned runtime with synthetic workloads, using no user data or delivery destinations.
  - Verify that repeated startup and later user edits preserve scheduling, commands, permissions and delivery settings.
  - Exercise natural completion, timeout, cancellation, and interactive isolation. Distinguish native Windows test results from platform-independent checks.
  - For a 600-second legacy job, verify that the launcher exits before its worker writes a local mock receipt and that the exec completes after the receipt.
  - Cover a legacy SQLite database with the same job ID in two stores and an unrelated job in the active store.
  - Cover the default partition when only the config file is relocated and when the state directory is explicitly configured.
docs:
  required: true
---

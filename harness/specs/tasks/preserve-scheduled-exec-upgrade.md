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
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - electron/gateway/**
  - electron/utils/openclaw-cron*.ts
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
docs:
  required: true
---

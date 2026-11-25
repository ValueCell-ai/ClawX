---
id: await-scheduled-windows-workers
title: Wait for Windows workers in synchronous scheduled exec
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let an admitted isolated cron agent explicitly wait for a host command and its Windows Job after the launcher exits.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-*cron*.test.ts
  - tests/fixtures/openclaw-windows-cron-descendants.mjs
  - tests/e2e/chat-scroll-to-latest.spec.ts
  - scripts/test-windows-cron-worker.mjs
  - harness/specs/tasks/await-scheduled-windows-workers.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - README*.md
expectedUserBehavior:
  - A scheduled foreground exec using awaitResults can run in its approved working directory and waits for its Windows worker through normal exit.
  - Existing exec approval, cancellation, timeout, and shutdown behavior still applies.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-cron-run-context.test.ts
  - tests/unit/openclaw-windows-cron-descendants.test.ts
  - node scripts/test-windows-cron-worker.mjs (Windows)
  - tests/e2e/chat-scroll-to-latest.spec.ts
acceptance:
  - Exercise a new isolated job with an explicit skill workdir, a short launcher and a worker writing a local receipt after launcher exit on Windows.
  - Verify scheduled, interactive, cancellation, timeout and legacy migration cases against the pinned runtime.
  - Verify the scroll-to-latest CI regression with wheel input and viewport assertions in Electron.
docs:
  required: true
---

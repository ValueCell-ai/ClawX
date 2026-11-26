---
id: retain-scheduled-worker-after-launch
title: Finish a scheduled Windows worker after its launch deadline
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let a Windows cron job with an existing 60-second launcher budget complete a supervised worker without rewriting its saved job or skill.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - scripts/test-windows-cron-worker-scheduler.mjs
  - tests/fixtures/*cron*.mjs
  - tests/unit/*cron*.test.ts
  - harness/specs/tasks/retain-scheduled-worker-after-launch.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - README*.md
expectedUserBehavior:
  - A matching approved Windows launcher that finishes within its 60-second deadline can leave a supervised worker to finish under a bounded worker deadline.
  - Ordinary commands and interactive tools keep their existing deadlines. Cancellation and shutdown still clean up the managed job.
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
  - node scripts/test-windows-cron-worker-scheduler.mjs (Windows, uv and a locally installed Python)
acceptance:
  - Verify completion through the real scheduler and a native Windows Job using a self-contained test worker.
  - Verify the persisted timeout stays at 60, the worker finishes after that deadline, and cron completes successfully.
  - Preserve startup deadline enforcement, cancellation, shutdown, and normal task limits.
docs:
  required: true
---

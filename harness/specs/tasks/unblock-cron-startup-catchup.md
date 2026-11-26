---
id: unblock-cron-startup-catchup
title: Admit manual runs while startup catch-up is in progress
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let the Gateway accept a manual run as soon as the scheduler has queued overdue work.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-cron-catchup-startup.test.ts
  - harness/specs/tasks/unblock-cron-startup-catchup.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - README*.md
expectedUserBehavior:
  - After an upgrade, another scheduled task can be triggered manually while an overdue run is still in progress.
  - Triggering the active task again returns already-running.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-cron-catchup-startup.test.ts
  - tests/unit/openclaw-061-cron-upgrade.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Scheduler startup waits for queue publication and launch before accepting manual runs.
  - An independent manual job can finish while the original catch-up run is still active.
  - The queue retains the active run and records its completion exactly once.
docs:
  required: true
---

On the first launch after upgrading from 0.6.1, an overdue task ran long enough for manual run requests to remain pending until the Gateway was restarted. The manual-run handler awaited scheduler startup, which in turn awaited the overdue job's completion.

The regression starts the pinned CronService against a temporary SQLite database and holds an overdue job open. It checks the other job's completion, the duplicate request for the active job, and the original job's eventual completion.

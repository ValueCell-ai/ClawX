---
id: clawx-system-automations
title: ClawX system automation policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Rules:
  - ClawX prelaunch config synchronization sets plugins.entries.memory-core.config.dreaming.enabled to false, including previously enabled installations. Preserve other settings, memory search and existing memory files.
  - Delegate managed dreaming job reconciliation to OpenClaw; do not delete cron SQLite rows or memory files from ClawX.
  - Main must exclude system heartbeat and managed dreaming jobs from the scheduled-task list before background repair and UI projection, on RPC and offline fallback paths alike.
  - Identify ownership by reserved declarations or exact historical internal payload markers with matching metadata, never by a display name alone. Keep ambiguous authored jobs visible.
  - Hiding heartbeat jobs is presentation-only; do not disable heartbeats or user schedules.
Validation:
  - Test fresh and previously enabled dreaming configurations and repeated synchronization.
  - Test current and historical internal jobs, disabled jobs, same-name user jobs and absence of background writes to hidden jobs.
  - Cover the task-list interaction with isolated Electron E2E fixtures.

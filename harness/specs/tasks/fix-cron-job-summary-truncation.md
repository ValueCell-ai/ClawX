---
id: fix-cron-job-summary-truncation
title: Restore complete scheduled-task replies from run transcripts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent completed Cron conversations from ending at OpenClaw's bounded run-summary limit when the full run transcript is available.
touchedAreas:
  - electron/services/cron-api.ts
  - electron/services/sessions-api.ts
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/fix-cron-job-summary-truncation.md
expectedUserBehavior:
  - Opening a scheduled-task conversation shows the complete final assistant reply instead of a 2000-character Cron summary ending in an ellipsis.
  - Duration and model metadata remain visible after the restored reply.
  - Missing or unreadable run transcripts continue to fall back to the bounded Cron summary.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
acceptance:
  - Electron Main remains the owner of scheduled-task history and continues to query Gateway cron.runs.
  - A summary matching OpenClaw's bounded-summary envelope is replaced only when the corresponding run transcript contains a longer assistant reply with the same prefix.
  - Run lookup accepts an explicit run-scoped sessionKey and can derive one from agent ID, job ID, and sessionId.
  - Short summaries, mismatched transcript text, and unavailable transcripts are returned unchanged.
  - ACP replay remains authoritative; restored Cron history is projected only when replay is empty.
docs:
  required: false
---

Use this task spec for the Cron history fallback repair that joins bounded
`cron.runs` summaries with their corresponding on-disk run transcripts.

---
id: render-cron-run-live-status
title: Render live execution status for cron-triggered runs without a session switch
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: When a scheduled cron job runs while the user is viewing that session, render its ACP updates and available cron history in the inline timeline without requiring a session switch.
touchedAreas:
  - harness/specs/tasks/render-cron-run-live-status.md
  - src/lib/cron-session-history.ts
  - src/stores/acp-chat-session.ts
  - src/stores/chat/cron-session-utils.ts
  - tests/unit/cron-session-utils.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
expectedUserBehavior:
  - ACP tool and message updates for the selected cron session render inline without a manual session switch.
  - Run-scoped cron session keys are normalized to the equivalent base cron session where catalog reconciliation requires it.
  - When ACP replay is empty, authorized cron session history can supply the visible prompt and final reply.
  - Renderer continues to use Host events / api-client boundaries; no new direct IPC or Gateway HTTP calls are added.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
requiredTests:
  - pnpm exec vitest run tests/unit/cron-session-utils.test.ts
  - pnpm exec playwright test tests/e2e/cron-run-live-status.spec.ts
  - pnpm run typecheck
acceptance:
  - A cron session-key equivalence helper treats the base cron key and its run-scoped variant as the same session.
  - ACP notifications for the selected cron session reduce into the same ordered in-memory timeline as other Chat sessions.
  - Empty ACP replay may be supplemented only by the authorized cron session-history route for that session.
  - Renderer does not add direct IPC calls or Gateway HTTP fetches outside the existing api-client / host-events path.
docs:
  required: false
---

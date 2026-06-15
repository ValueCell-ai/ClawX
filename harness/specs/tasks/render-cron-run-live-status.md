---
id: render-cron-run-live-status
title: Render live execution status for cron-triggered runs without a session switch
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: When a scheduled (cron) job fires while the user is viewing that cron session, ClawX must render the live running state (Thinking indicator, Execution Graph, tool steps) in realtime. Today the Gateway streams runtime events under the run-scoped session key (agent:<id>:cron:<jobId>:run:<sessionId>) while the UI tracks the base cron key (agent:<id>:cron:<jobId>), so events are dropped by strict session-key equality and the user must switch sessions to force a transcript reload.
touchedAreas:
  - harness/specs/tasks/render-cron-run-live-status.md
  - src/stores/chat/cron-session-utils.ts
  - src/stores/chat.ts
  - src/stores/gateway.ts
  - src/components/layout/Sidebar.tsx
  - tests/unit/cron-session-utils.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/e2e/cron-run-live-status.spec.ts
expectedUserBehavior:
  - When a cron job triggers while the user is viewing that cron session, the renderer adopts the run, surfaces the running/Thinking state, and renders the Execution Graph live from streamed runtime events.
  - Runtime events whose sessionKey carries the run-scoped suffix are treated as belonging to the equivalent base cron session the user is viewing.
  - When the cron run ends, the renderer reloads the transcript for the current session so the completed graph and final reply render without a manual session switch.
  - Background :main heartbeat runs continue to NOT surface a Thinking indicator.
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
  - pnpm exec vitest run tests/unit/gateway-events.test.ts
  - pnpm run typecheck
acceptance:
  - A cron session-key equivalence helper treats the base cron key and its run-scoped variant as the same session.
  - chat store handleChatEvent / handleRuntimeEvent apply cron run-scoped events to the equivalent base cron session currently in view.
  - Cron sessions are treated as trackable inbound runs so run.started arms the running state, while :main heartbeats remain suppressed.
  - gateway runtime-event dispatch reloads history for the current cron session on run end (and start) using equivalence rather than strict equality.
  - Renderer does not add direct IPC calls or Gateway HTTP fetches outside the existing api-client / host-events path.
docs:
  required: false
---

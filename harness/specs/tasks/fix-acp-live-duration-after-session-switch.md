---
id: fix-acp-live-duration-after-session-switch
title: Keep ACP live duration running after a session switch
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent a transcript timing supplement from replacing the restored live timer when an in-flight ACP prompt is reactivated after switching conversations.
touchedAreas:
  - harness/specs/tasks/fix-acp-live-duration-after-session-switch.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Switching to another conversation and returning to an in-flight ACP turn restores its latest timeline and keeps its elapsed duration increasing from the original send time.
  - Partial transcript records written by the still-running turn never freeze the timer as a completed historical duration.
  - Once the ACP prompt settles, the live duration freezes normally and may be reconciled to the bounded transcript duration.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - host-events-fallback-policy
  - acp-chat-state-and-history
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/fix-acp-live-duration-after-session-switch.md
acceptance:
  - A Main-confirmed active-prompt reactivation restores the matching memory-only timeline and running turn timing.
  - Renderer does not start historical transcript supplementation for a load that reactivates a live prompt snapshot.
  - Transcript timing supplementation remains enabled for ordinary completed history loads and after successful live prompt settlement.
  - Live updates received while another conversation is selected remain ordered and visible after returning.
  - Unit and Electron E2E coverage reproduce a conversation switch and prove the restored elapsed duration continues increasing despite partial transcript timing being available.
docs:
  required: true
---

## Scope

This task tightens the boundary between live timing and the metadata-only historical transcript supplement. It does not change ACP routing, transcript parsing, timeline reduction, or persisted history authority.

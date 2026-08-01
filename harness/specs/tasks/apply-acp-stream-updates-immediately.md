---
id: apply-acp-stream-updates-immediately
title: Apply live ACP stream updates immediately
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove Renderer-side live ACP chunk batching so Streamdown receives each accepted host event without a 16 ms queue.
touchedAreas:
  - harness/specs/tasks/apply-acp-stream-updates-immediately.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-streamdown-rendering.spec.ts
expectedUserBehavior:
  - Live assistant output advances as each ACP host event arrives instead of waiting for a Renderer batching timer.
  - Stream ordering, stale-generation rejection, permission handling, and completed prompt behavior remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-events-fallback-policy
  - acp-chat-state-and-history
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-streamdown-rendering.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Each accepted live ACP session update is applied synchronously through the existing typed host-event subscription.
  - Two consecutive live ACP chunks produce two ordered Store notifications rather than one timer-batched notification.
  - Historical session replay retains its existing generation-scoped reduction behavior.
  - The Renderer introduces no replacement queue, timer, transport, or fallback path.
docs:
  required: false
---

## Scope

This task changes only the Renderer Store update cadence for live ACP host events. It does not change ACP transport, Main-process routing, timeline reduction semantics, Streamdown configuration, or persisted history authority.

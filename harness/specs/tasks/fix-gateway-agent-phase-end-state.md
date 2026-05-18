---
id: fix-gateway-agent-phase-end-state
title: Keep chat run active across non-terminal gateway phase end events
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent Gateway agent lifecycle hints from prematurely clearing the chat sending state while tool execution continues.
touchedAreas:
  - .gitignore
  - harness/specs/tasks/fix-gateway-agent-phase-end-state.md
  - src/stores/gateway.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/unit/gateway-events.test.ts
expectedUserBehavior:
  - The chat composer keeps showing the stop control while an agent run continues across tool rounds.
  - Intermediate `phase: end` notifications refresh history without making the run look interrupted.
  - Progressive streaming delta notifications without sequence numbers continue updating the visible response.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm exec vitest run tests/unit/gateway-events.test.ts tests/unit/chat-event-dedupe.test.ts
  - pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts
  - pnpm run typecheck
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - `phase: end` no longer clears `sending`, `activeRunId`, `pendingFinal`, or `lastUserMessageAt`.
  - Terminal phases such as `completed` still clear chat run state.
  - Gateway event dedupe does not suppress same-run delta notifications that do not carry `seq`.
docs:
  required: false
---

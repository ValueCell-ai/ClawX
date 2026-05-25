---
id: fix-chat-stuck-processing-tool-results
title: Clear stale chat run state when Gateway reports the session is idle
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the renderer from staying stuck on “Processing tool results…” when a terminal Gateway lifecycle event was missed but sessions.list reports the current session has no active run.
touchedAreas:
  - harness/specs/tasks/fix-chat-stuck-processing-tool-results.md
  - package.json
  - pnpm-lock.yaml
  - src/stores/chat.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat/types.ts
  - tests/unit/chat-session-actions.test.ts
expectedUserBehavior:
  - If Gateway reports the current session has status done or hasActiveRun=false after the user's send timestamp, the chat composer and tool-processing indicator return to idle.
  - A fresh in-flight send is not prematurely cleared by stale sessions.list metadata from before the user message.
  - Renderer continues to use the existing gateway:rpc Main-process boundary.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm exec vitest run tests/unit/chat-session-actions.test.ts
  - pnpm run typecheck
acceptance:
  - Renderer does not add direct IPC calls outside the existing api-client invocation path.
  - Renderer does not fetch Gateway HTTP directly.
  - sessions.list idle metadata reconciles stale sending/activeRunId/pendingFinal state for the current session.
  - sessions.list metadata older than the current user send does not clear active state.
docs:
  required: false
---

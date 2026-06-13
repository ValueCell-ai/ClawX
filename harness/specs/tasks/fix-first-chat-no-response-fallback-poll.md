---
id: fix-first-chat-no-response-fallback-poll
title: Restore fallback transcript polling so missing streamed events do not fail the first chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the false "The model did not respond within 120 seconds" / "No response received from the model" errors on the first chat after Gateway startup when streamed chat/runtime events never reach the renderer, by polling chat.history as a fallback progress source during active sends.
touchedAreas:
  - harness/specs/tasks/fix-first-chat-no-response-fallback-poll.md
  - src/stores/chat.ts
  - tests/unit/chat-store-history-retry.test.ts
expectedUserBehavior:
  - When a send receives no streamed chat/runtime events (e.g. first run after Gateway startup or a silent WS drop), the renderer polls chat.history and surfaces transcript progress instead of firing the 120s/130s no-response safety errors.
  - When the transcript shows a conclusive assistant reply, the run closes normally (sending cleared, reply rendered) without any error banner.
  - While streamed events are fresh, the fallback poll issues no extra chat.history RPCs, so healthy streamed runs are unaffected.
  - Renderer continues to use the existing gateway rpc Main-process boundary for chat.history polling.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm exec vitest run tests/unit/chat-store-history-retry.test.ts
  - pnpm run typecheck
acceptance:
  - The active sendMessage path arms a fallback transcript poll that only issues chat.history RPCs after sustained streamed-event silence.
  - Streamed chat events no longer permanently clear the fallback poll timer; the poll self-throttles via event freshness instead.
  - A run whose transcript contains a final assistant reply closes without emitting the no-response safety errors even when zero streamed events arrive.
  - Renderer does not add direct IPC calls or Gateway HTTP fetches outside the existing api-client invocation path.
docs:
  required: false
---

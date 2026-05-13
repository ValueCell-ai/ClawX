---
id: fix-chat-history-gateway-timeout
title: Fix chat history timeout through gateway backend communication
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reduce startup chat.history contention so foreground history loads do not time out behind sidebar background hydration.
touchedAreas:
  - harness/specs/tasks/fix-chat-history-gateway-timeout.md
  - electron/api/routes/sessions.ts
  - electron/gateway/rpc-backpressure.ts
  - electron/main/ipc-handlers.ts
  - src/components/layout/Sidebar.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/message-utils.ts
  - src/stores/chat.ts
  - src/stores/chat/history-actions.ts
  - src/stores/chat/history-startup-retry.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat/session-label-hydration.ts
  - src/stores/chat/store-api.ts
  - src/stores/chat/types.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/unit/session-label-fetch.test.ts
  - tests/unit/session-summaries-route.test.ts
expectedUserBehavior:
  - Foreground chat history loading is prioritized during gateway startup and restart.
  - Sidebar/session label hydration does not compete with the first visible history load.
  - Sidebar label hydration uses the existing host API boundary instead of heavy gateway chat.history fan-out.
  - Renderer continues to use the existing host/store boundary.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm run typecheck
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/unit/session-label-fetch.test.ts
  - tests/unit/session-summaries-route.test.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Startup/restart no longer fans out sidebar label chat.history calls before the visible session history finishes loading.
  - Sidebar label hydration no longer depends on gateway chat.history full-session scans.
  - Foreground history uses a bounded startup RPC wait and falls back to local transcript reads instead of surfacing transient RPC timeout errors.
  - Main-process chat.history RPCs are single-flighted/backpressured before reaching the Gateway.
docs:
  required: false
---

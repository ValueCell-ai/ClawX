---
id: fix-gateway-ready-session-catalog-reload
title: Fix delayed sidebar session catalog reload after gateway restart
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Align gateway readiness signaling with sidebar session catalog refresh after restart.
touchedAreas:
  - harness/specs/tasks/fix-gateway-ready-session-catalog-reload.md
  - electron/gateway/manager.ts
  - src/components/layout/Sidebar.tsx
  - src/stores/chat.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Settings/index.tsx
  - src/pages/Setup/index.tsx
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
expectedUserBehavior:
  - After gateway restart, the sidebar session catalog reloads as soon as the gateway becomes RPC-ready.
  - UI does not show a fully healthy green running state while gatewayReady is still false.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Gateway running-but-not-ready state is surfaced distinctly from fully ready.
  - Sidebar reloads the session catalog when gatewayReady becomes true after a restart.
docs:
  required: false
---

---
id: chat-tool-events-runtime-pipeline
title: Make Chat runtime event-first with Main-owned Gateway communication
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move Chat send/history/control and streamed runtime events to a Main-owned pipeline, consume OpenClaw tool events as the active-run source of truth, simplify Execution Graph active rendering, and remove the legacy dual-track Chat store path.
touchedAreas:
  - harness/specs/tasks/chat-tool-events-runtime-pipeline.md
  - electron/api/routes/gateway.ts
  - electron/gateway/chat-runtime-events.ts
  - electron/gateway/event-dispatch.ts
  - electron/gateway/manager.ts
  - electron/gateway/ws-client.ts
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/preload/index.ts
  - shared/chat-runtime-events.ts
  - src/lib/host-events.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/image-generation-status.ts
  - src/pages/Chat/task-visualization.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/stores/chat/runtime-graph.ts
  - src/stores/gateway.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-runtime-event-handlers.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/image-generation-status.test.ts
  - tests/unit/task-visualization.test.ts
expectedUserBehavior:
  - Chat send/history/abort flows no longer depend on renderer direct Gateway WebSocket transport.
  - Active chat runs stream tool lifecycle and related process updates through Main-owned runtime events.
  - Execution Graph for the active run reflects streamed runtime events instead of inferring the live timeline from history polling.
  - Final assistant reply continues to render as a normal chat bubble, while Execution Graph focuses on process steps.
  - Tool-produced file artifacts continue to surface under the final assistant message.
  - Historical sessions still reconstruct process graphs from transcript/message history as a fallback.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
requiredTests:
  - pnpm run typecheck
  - pnpm run lint
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/chat-runtime-event-handlers.test.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Renderer Chat code uses Host API / Host events rather than renderer-owned Gateway transport.
  - Main Gateway connection declares the capability needed to receive streamed tool events.
  - Main normalizes OpenClaw chat/agent runtime events before forwarding them to the renderer.
  - Active-run Execution Graph is driven by streamed runtime events and only updates existing steps by stable runtime identifiers.
  - Default chat history polling is removed from the active-run happy path.
  - Chat store no longer maintains separate live logic in both the monolithic store and an unused duplicate action path.
docs:
  required: false
---

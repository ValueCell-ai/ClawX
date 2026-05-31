---
id: remove-host-api-server-and-renderer-gateway-transports
title: Remove local Host API server and renderer Gateway transports
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Collapse backend communication to typed Electron IPC in the renderer, with OpenClaw Gateway WebSocket ownership kept in Electron Main.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/superpowers/**
  - harness/**
  - src/**
  - tests/**
  - electron/api/**
  - electron/extensions/**
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
  - src/lib/api-client.ts
  - src/lib/host-events.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/pages/Settings/index.tsx
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/main/ipc/**
  - electron/preload/**
  - electron/services/**
  - electron/gateway/**
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/host-api-fallback-policy.md
  - harness/specs/rules/api-client-transport-policy.md
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-invoke.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/api-client.test.ts
  - tests/unit/gateway-ws-trace.test.ts
expectedUserBehavior:
  - Settings, channels, agents, providers, skills, cron, chat, sessions, files, media, usage, and diagnostics continue to work through typed hostApi calls.
  - Renderer no longer starts or contacts a local Host API HTTP server.
  - Renderer no longer opens a direct WebSocket or HTTP proxy transport to OpenClaw Gateway.
  - Gateway RPC and Gateway events continue through the Main-owned Gateway manager connection.
  - Gateway WebSocket frame diagnostics are available from Main-process logs when CLAWX_GATEWAY_WS_TRACE=1 is set.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - docs-sync
requiredTests:
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-invoke.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/api-client.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - No production source references the legacy Host API fetch/token IPC names, Gateway HTTP proxy channel, local Host API server startup, Host event bus, or renderer Gateway WS diagnostic toggles.
  - src/lib/api-client.ts is IPC-only and does not construct WebSocket or HTTP Gateway transports.
  - src/lib/host-api.ts exposes typed hostApi facade methods and does not export a path-based fetch helper.
  - src/lib/host-events.ts subscribes through typed IPC events and does not fall back to SSE/EventSource.
  - electron/api and local Host API route tests are removed.
  - README.md, README.zh-CN.md, and README.ja-JP.md describe typed IPC and Main-owned Gateway WebSocket ownership.
docs:
  required: true
---

Use this spec when removing or auditing legacy renderer/Main/backend communication paths.

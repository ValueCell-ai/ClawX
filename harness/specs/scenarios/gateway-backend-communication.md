---
id: gateway-backend-communication
title: Gateway Backend Communication
type: runtime-bridge
ownedPaths:
  - src/lib/api-client.ts
  - src/lib/host-api.ts
  - src/stores/gateway.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - electron/api/**
  - electron/main/ipc/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:18789 in src/**
  - fetch("http://127.0.0.1:18789 in src/**
  - fetch('http://localhost:18789 in src/**
  - fetch("http://localhost:18789 in src/**
  - clawx:allow-localhost-fallback outside src/lib/host-api.ts and tests
  - clawx:allow-sse-fallback outside src/lib/host-events.ts and tests
  - clawx:gateway-ws-diagnostic outside src/lib/api-client.ts and tests
---

Gateway backend communication covers all ClawX paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` or `src/lib/api-client.ts` -> Electron Main host route or IPC handler -> gateway proxy / OpenClaw Gateway -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Explicit local fallback flags are narrow exceptions:
`clawx:allow-localhost-fallback` belongs to Host API browser fallback only, `clawx:allow-sse-fallback` belongs to host event SSE fallback only, and `clawx:gateway-ws-diagnostic` belongs to API client transport diagnostics only.

Channel/plugin migration behavior is also part of this scenario when ClawX rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

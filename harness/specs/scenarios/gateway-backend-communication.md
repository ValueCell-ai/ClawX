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
  - electron/main/ipc/**
  - electron/services/**
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
  - provider-default-invariant
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - window.electron.ipcRenderer.invoke in src/pages/**
  - window.electron.ipcRenderer.invoke in src/components/**
  - fetch('http://127.0.0.1:18789 in src/**
  - fetch("http://127.0.0.1:18789 in src/**
  - fetch('http://localhost:18789 in src/**
  - fetch("http://localhost:18789 in src/**
  - new WebSocket('ws://127.0.0.1:18789 in src/**
  - new WebSocket("ws://127.0.0.1:18789 in src/**
  - new WebSocket('ws://localhost:18789 in src/**
  - new WebSocket("ws://localhost:18789 in src/**
---

Gateway backend communication covers all ClawX paths that move data between the visual desktop UI and OpenClaw runtime/backend services.

Allowed flow:
Renderer page/component -> `src/lib/host-api.ts` or `src/lib/api-client.ts` -> Electron Main typed host service or IPC handler -> Main-owned OpenClaw Gateway WebSocket -> runtime result -> store/UI.

Renderer code must not own transport selection, direct IPC channels, direct Gateway HTTP calls, retry policy, or protocol fallback.

Renderer code must not create direct Gateway WebSocket connections. Gateway frame diagnostics must be emitted by Main-process Gateway logging.

Channel/plugin migration behavior is also part of this scenario when ClawX rewrites OpenClaw config before Gateway launch. Upgrades must preserve single-owner channel registration for migrated plugin-backed channels such as Feishu/Lark.

Scheduled-task history is Main-owned backend data. Current OpenClaw versions must be queried through the Gateway `cron.runs` RPC; direct file reads are allowed only as a compatibility fallback for older file-backed runtimes. When a cron base session has no ACP replay, Renderer may project that typed host result into a generation-scoped, in-memory historical ACP timeline, but must not replace or duplicate non-empty ACP replay.

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
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/stores/chat/session-catalog.ts
  - electron/main/ipc/**
  - electron/services/**
  - electron/gateway/**
  - electron/preload/**
  - electron/utils/**
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-catalog.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-event-dispatch.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/session-label-hydration.test.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - shared/web-browser.ts
  - electron/main/web-browser-policy.ts
  - electron/main/web-browser-session.ts
  - electron/services/web-browser-api.ts
  - tests/unit/web-browser-url.test.ts
  - tests/unit/web-browser-policy.test.ts
  - tests/unit/web-browser-session.test.ts
  - tests/unit/web-browser-api.test.ts
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    when:
      - user-visible gateway status changes
      - user-visible chat send/receive behavior changes
      - channels/agents/settings UI depends on new backend response shape
      - Web Browser guest, navigation, session, permission, or data policy changes
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
  - sidebar-session-attention-authority
  - web-browser-security-and-lifecycle
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

The Web Browser privileged bridge is also Main-owned: Renderer address and recovery navigation, data clearing, and external opening flow through the typed Host API. The artifact tab value `web-browser` identifies this Electron guest and remains distinct from the Workspace file browser value `browser`; UI ownership stays in `chat-workspace-and-navigation`. The durable guest contract is `harness/reference/web-browser.md`.

Gateway session-catalog subscription, normalization, ordered list/event replay, attention transitions, and reconnect recovery are documented in `harness/reference/sidebar-session-attention.md`.

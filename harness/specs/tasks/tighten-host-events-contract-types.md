---
id: tighten-host-events-contract-types
title: Tighten host event contract types
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move Main-to-renderer host event payload typing into a shared contract so renderer subscribers no longer provide ad-hoc generic payload types.
touchedAreas:
  - AGENTS.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/superpowers/**
  - package.json
  - tsconfig.json
  - tsconfig.node.json
  - tsconfig.web.json
  - vite.config.ts
  - vitest.config.ts
  - electron/**
  - src/**
  - tests/**
  - harness/**
  - shared/**
  - shared/host-events/**
  - shared/types/**
  - src/lib/host-events.ts
  - src/stores/gateway.ts
  - src/components/channels/**
  - src/components/settings/**
  - electron/preload/**
  - electron/main/ipc-handlers.ts
  - electron/gateway/**
  - electron/utils/**
  - tests/unit/host-events.test.ts
  - tests/unit/gateway-events.test.ts
expectedUserBehavior:
  - No visible UI or runtime behavior changes.
  - Renderer stores and components continue to receive Gateway, OAuth, and QR channel events through hostEvents.
  - Gateway status, chat notifications, channel status refreshes, OAuth login progress, and QR login feedback still update the UI as before.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - docs-sync
requiredTests:
  - tests/unit/host-events.test.ts
  - tests/unit/gateway-events.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - src/lib/host-events.ts derives subscriber payload types from a shared host-events contract.
  - Renderer call sites do not pass generic payload types to hostEvents subscribers.
  - Known Gateway, OAuth, and QR channel event payloads use concrete shared types instead of caller-side unknown casts where the full chain determines the shape.
  - Host events still subscribe through IPC and do not reintroduce SSE/EventSource fallback.
docs:
  required: false
---

Use this spec when changing Main-to-renderer event subscription typing or event payload contracts.

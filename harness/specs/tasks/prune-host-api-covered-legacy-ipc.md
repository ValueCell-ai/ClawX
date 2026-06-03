---
id: prune-host-api-covered-legacy-ipc
title: Prune hostApi-covered legacy direct IPC handlers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove legacy direct IPC channels that are already covered by host:invoke/hostApi and are no longer invoked by renderer code.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/superpowers/**
  - harness/**
  - electron/**
  - src/**
  - tests/**
  - electron/main/ipc-handlers.ts
  - electron/preload/index.ts
  - src/lib/host-api.ts
  - shared/host-api/contract.ts
  - tests/unit/host-api-facade.test.ts
  - harness/specs/tasks/prune-host-api-covered-legacy-ipc.md
expectedUserBehavior:
  - No visible UI or runtime behavior changes.
  - Renderer code continues to use hostApi for logs, skills, ClawHub, channel configuration, provider account helpers, and provider OAuth.
  - Remaining direct IPC channels are those still intentionally used by renderer code or compatibility tests.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - docs-sync
requiredTests:
  - tests/unit/host-api-facade.test.ts
  - pnpm run typecheck
  - pnpm test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - HostApi-covered legacy direct IPC channels are not registered in electron/main/ipc-handlers.ts.
  - HostApi-covered legacy direct IPC channels are not exposed through the preload invoke allowlist.
  - Legacy Cron actions are not routed through app:request now that Cron uses hostApi.cron.
  - Direct IPC channels with no renderer invoke callers are removed from Main and preload.
  - Direct IPC channels still used by renderer code remain available.
  - Gateway event forwarding and provider/channel OAuth event forwarding continue to work.
docs:
  required: false
---

## Scope

Prune direct IPC handlers whose implementation has an equivalent typed host
service and whose old channel is no longer invoked by renderer source code.
Keep event forwarding and still-used direct IPC channels intact.

## Out of scope

- Removing `app:request` or the old provider CRUD fallback in the same change.
- Removing direct IPC channels still used by Setup, file preview, shell/dialog,
  update, window controls, or tests that intentionally cover legacy fallback.
- Reworking Gateway event subscription channels.

---
id: tighten-host-api-contract-types
title: Tighten host API contract types across renderer and Main
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace ad-hoc unknown-based host invoke typing with a function-shaped HostApiContract shared by the renderer facade, preload bridge, and Main host service registry.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/superpowers/**
  - harness/**
  - electron/**
  - src/**
  - tests/**
  - harness/specs/tasks/tighten-host-api-contract-types.md
  - shared/host-api/contract.ts
  - src/lib/host-api-client.ts
  - shared/host-api/types.ts
  - src/lib/host-api.ts
  - src/types/electron.d.ts
  - electron/preload/index.ts
  - electron/main/ipc/host-contract.ts
  - electron/main/ipc/host-invoke.ts
  - electron/services/**
  - electron/services/payload-utils.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-invoke.test.ts
expectedUserBehavior:
  - No visible UI or runtime behavior changes.
  - Renderer pages and stores continue to call backend operations through hostApi.<module>.<action>().
  - Unsupported or malformed host:invoke requests still return validation or unsupported errors from Main.
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
  - tests/unit/host-invoke.test.ts
  - pnpm run typecheck
  - pnpm test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - HostApiContract is expressed as module/action function signatures, not { input, output } descriptors.
  - invokeHost infers payload and result types from HostApiContract instead of accepting string/string/unknown plus a caller-supplied output generic.
  - src/lib/host-api.ts facade methods expose typed inputs for normal hostApi calls; gateway.rpc keeps a generic result escape hatch for dynamic Gateway RPCs.
  - Electron Main host service registration is constrained by the same HostApiContract.
  - Host service handlers inherit payload parameter types from HostApiContract instead of annotating payload as unknown.
  - Shared payload shape checks live in electron/services/payload-utils.ts instead of being redefined in each service file.
  - Runtime host request validation continues to treat untrusted IPC input as unknown at the dispatcher boundary.
docs:
  required: false
---

## Scope

This task is a type-safety refactor for the existing typed IPC bridge created by
`remove-host-api-server-and-renderer-gateway-transports`. It does not add a new
backend route, change transport selection, or alter user-visible flows.

## Out of scope

- Reworking legacy direct IPC channels that still exist outside host:invoke.
- Adding runtime schema validation for every payload.
- Removing dynamic typing from Gateway RPC method-specific params/results.

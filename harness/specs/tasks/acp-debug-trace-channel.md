---
id: acp-debug-trace-channel
title: Add ACP debug trace diagnostics channel
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a bounded redacted diagnostics trace for ACP bridge events and renderer image-projection decisions so ClawX can diagnose ACP image rendering failures without modifying OpenClaw.
touchedAreas:
  - harness/specs/tasks/acp-debug-trace-channel.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/diagnostics-trace-safety.md
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - electron/services/diagnostics-api.ts
  - electron/services/**
  - electron/extensions/builtin/diagnostics.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-trace.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
expectedUserBehavior:
  - No visible Chat UI behavior changes.
  - Developers can retrieve recent ACP bridge and renderer projection trace entries through the diagnostics host API.
  - Renderer continues to use host-api and does not add direct IPC or Gateway HTTP calls.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - diagnostics-trace-safety
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-trace.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-chat-store.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ACP trace entries are stored in a bounded Main-owned ring buffer with chronological sequence numbers.
  - Main records representative ACP lifecycle, upstream notification, and downstream renderer envelope events.
  - Renderer image-projection decision points can append compact diagnostics entries through hostApi.diagnostics.recordAcpTrace.
  - diagnostics.acpTrace returns a redacted snapshot containing both Main and renderer-originated entries.
  - Sensitive values and oversized payloads are redacted or summarized before storage.
  - Existing ACP chat rendering and projection behavior is unchanged except for best-effort trace recording.
docs:
  required: false
---

## Scope

This task adds observability for ACP communication and image projection decisions. It does not attempt to repair image rendering behavior directly.

## Out of Scope

- OpenClaw source changes.
- Persistent trace files.
- A user-visible diagnostics panel.
- Gateway WebSocket trace changes.

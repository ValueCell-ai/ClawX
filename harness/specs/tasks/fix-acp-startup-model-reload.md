---
id: fix-acp-startup-model-reload
title: Prevent startup model cleanup from interrupting ACP session load
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Wait for the provider snapshot before clearing an unavailable agent model override so startup does not schedule a redundant Gateway restart.
touchedAreas:
  - harness/specs/tasks/fix-acp-startup-model-reload.md
  - src/pages/Chat/ChatInput.tsx
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
expectedUserBehavior:
  - Starting ClawX with an existing agent model override does not clear the override before configured providers load.
  - ACP session loading is not interrupted by a model-triggered Gateway restart during startup.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - provider-model-selection-authority
  - renderer-main-boundary
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Model override cleanup waits until the initial provider snapshot request settles.
  - A valid persisted override is preserved while provider data is still loading.
  - Renderer backend calls remain routed through host-api.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: false
---

## Scope

- Gate automatic stale-model cleanup on completion of the initial provider snapshot refresh.
- Cover delayed provider startup with unit and Electron E2E regression checks.

## Out Of Scope

- Changing Gateway restart or ACP retry policy.
- Repairing unrelated stale OpenClaw extensions.

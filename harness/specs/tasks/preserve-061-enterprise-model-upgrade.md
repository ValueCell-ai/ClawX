---
id: preserve-061-enterprise-model-upgrade
title: Preserve authorized agent models and wait for managed upgrade startup
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Validate a nonempty 0.6.1 enterprise profile against the current host and extension, including model publication and slow first startup.
touchedAreas:
  - src/pages/Chat/index.tsx
  - src/stores/gateway.ts
  - tests/e2e/gateway-lifecycle.spec.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/preserve-061-enterprise-model-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - An authorized explicit legacy agent model survives first startup with an older enterprise preference snapshot.
  - An authorized newly added router model can be selected and used after the directory refresh and after a restart.
  - A chat waiting for a managed upgrade does not fail merely because the Doctor runs for more than five minutes.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredTests:
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/gateway-events.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
acceptance:
  - Verify legacy selection and catalog expansion in isolated state and retain authorization checks for removed or unknown models.
  - A stopped or failed Gateway still yields a bounded failure. ACP waits for the Gateway before opening shared state.
  - If the Gateway becomes ready while status listeners are being registered, Chat sees the new readiness immediately when initialization completes.
  - Comms replay and compare pass.
docs:
  required: true
---

The enterprise extension and the community host are built from separate repositories.
Exercise the legacy preferences and router directory through enterprise startup and
check the Gateway catalog and model selection using the pinned OpenClaw runtime.

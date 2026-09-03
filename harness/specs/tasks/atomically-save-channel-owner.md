---
id: atomically-save-channel-owner
title: Save channel credentials and ownership atomically
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent multi-agent channels from restarting with credentials enabled before their required account owner binding is committed.
touchedAreas:
  - harness/specs/tasks/atomically-save-channel-owner.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
  - electron/services/channels-api.ts
  - electron/utils/agent-config.ts
  - electron/utils/channel-config.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/channels-binding-regression.spec.ts
expectedUserBehavior:
  - Saving Telegram default-account credentials in a multi-agent installation starts the channel with `telegram:default` explicitly owned by the main Agent.
  - Changed channel credentials and their inferred account owner become visible to OpenClaw in the same config revision.
  - Existing no-change saves repair a missing scoped binding without rewriting channel credentials.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - openclaw-config-delivery
  - backend-communication-boundary
  - capability-owner-resolution
  - channel-plugin-migration-guards
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/channels-binding-regression.spec.ts
acceptance:
  - The changed-config save path commits channel configuration and its inferred scoped binding in one Main-owned `mutateOpenClawConfig` transaction.
  - The transaction remains replayable and performs no nested config writes or lifecycle operations.
  - A default account selects the explicit `main` Agent when present; a non-default account selects a same-ID Agent when present.
  - Native Gateway reload cannot observe an enabled multi-agent channel without the binding committed by that save.
  - Focused unit tests, type checks, lint, communication regression checks, and the channel Electron E2E pass.
docs:
  required: true
---

This task references `gateway-backend-communication` because channel saves cross
the typed Host API boundary and can cause an immediate OpenClaw-native reload.
The channel credentials and required routing owner must therefore be one
coordinator-owned config commit rather than sequential mutations.

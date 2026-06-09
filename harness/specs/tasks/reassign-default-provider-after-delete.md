---
id: reassign-default-provider-after-delete
title: Reassign the default provider after deleting it
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep ClawX provider account state and the OpenClaw default model valid when the user deletes the current default provider while other provider accounts remain.
touchedAreas:
  - harness/specs/tasks/reassign-default-provider-after-delete.md
  - harness/specs/rules/provider-default-invariant.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/services/providers-api.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
expectedUserBehavior:
  - Deleting the current default provider automatically promotes a remaining provider to default.
  - The promoted provider remains default after the app reloads its provider snapshot.
  - Deleting a non-default provider leaves the current default unchanged.
  - Deleting the final provider leaves no default provider.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - provider-default-invariant
  - renderer-main-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/host-services.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - The typed providers deleteAccount host action detects whether the deleted account is the current default.
  - When accounts remain, replacement selection prefers enabled accounts and then the most recently updated account.
  - The replacement default is persisted and synchronized to OpenClaw before the deleted provider runtime configuration is removed.
  - Deleting a non-default account does not invoke default-provider persistence or runtime synchronization.
  - Deleting the last account does not attempt to assign a replacement default.
  - Renderer transport boundaries remain unchanged.
  - Focused unit tests, Electron E2E coverage, harness validation, communication replay, and communication compare pass.
docs:
  required: false
---

## Background

Deleting a provider account currently removes `defaultProviderAccountId` and
the matching `agents.defaults.model.primary` value when that provider was the
default. The delete path does not promote another configured account, leaving
the Models page and OpenClaw runtime without a default even when usable
providers remain.

## Scope

- Select a deterministic replacement when the current default account is
  deleted.
- Persist and synchronize that replacement through the existing Main-owned
  provider APIs.
- Add unit and Electron E2E regression coverage.

## Out Of Scope

- Adding a replacement-provider chooser to the delete UI.
- Changing account ordering in the Models page.
- Assigning a default when no provider accounts remain.
- README updates because the documented provider management interface and
  workflow do not change.

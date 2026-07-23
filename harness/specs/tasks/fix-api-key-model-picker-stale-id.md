---
id: fix-api-key-model-picker-stale-id
title: Hide stale API-key model IDs after provider edits
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep chat model selection aligned with the explicit model saved for single-model built-in provider accounts while preserving historical OpenClaw model metadata and custom/local multi-model behavior.
touchedAreas:
  - harness/specs/tasks/fix-api-key-model-picker-stale-id.md
  - harness/specs/rules/provider-model-selection-authority.md
  - src/lib/model-options.ts
  - tests/unit/model-options.test.ts
  - tests/e2e/chat-model-picker.spec.ts
expectedUserBehavior:
  - Editing a built-in API-key provider from an old model ID to a new model ID removes the old ID from the chat model picker.
  - New chats resolve the built-in provider to its newly saved explicit model instead of a historical runtime model row.
  - Custom and local multi-model providers continue to expose every configured custom model.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - renderer-main-boundary
requiredTests:
  - tests/unit/model-options.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Built-in provider accounts with an explicit account.model contribute only that normalized model to the chat picker, regardless of auth mode.
  - Historical models.providers rows remain preserved as metadata and do not reappear as alternate built-in selections.
  - Custom and Ollama multi-model picker behavior remains unchanged.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: false
---

## Background

OpenClaw provider synchronization intentionally retains existing model rows to
preserve capability metadata. Provider account snapshots copy those rows into
`metadata.customModels`. The chat picker already ignores stale metadata for
browser OAuth accounts, but API-key and device-OAuth built-in accounts still
allow historical IDs to override the explicit model saved by the user.

## Scope

- Make the explicit model authoritative for every single-model built-in account.
- Preserve custom and local multi-model options from synchronized metadata.
- Preserve historical OpenClaw model rows and their capability metadata.
- Cover API-key stale-ID behavior with unit and Electron E2E tests.

## Out Of Scope

- Deleting historical model capability rows from `openclaw.json`.
- Collapsing custom or Ollama multi-model provider lists.
- Changing provider edit form fields or runtime transport behavior.

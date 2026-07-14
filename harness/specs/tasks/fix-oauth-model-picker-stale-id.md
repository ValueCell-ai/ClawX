---
id: fix-oauth-model-picker-stale-id
title: Hide stale OAuth model IDs after provider edits
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep the chat model picker aligned with the currently selected OAuth model while preserving historical OpenClaw model metadata and normalizing provider-prefixed model input before runtime sync.
touchedAreas:
  - harness/specs/tasks/fix-oauth-model-picker-stale-id.md
  - harness/specs/rules/provider-model-selection-authority.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - src/lib/model-options.ts
  - electron/services/providers/provider-runtime-sync.ts
  - tests/unit/model-options.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/e2e/chat-model-picker.spec.ts
expectedUserBehavior:
  - Editing an OpenAI OAuth account from gpt-5.5 to gpt-5.6 removes gpt-5.5 for that account from the chat model picker.
  - Entering openai/gpt-5.6 is normalized to the runtime model ID gpt-5.6 instead of producing openai/openai/gpt-5.6.
  - Custom multi-model providers continue to expose every configured custom model.
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
  - tests/unit/provider-runtime-sync.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - OAuth browser accounts with an explicit account.model contribute only that normalized model to the chat picker.
  - Provider-prefixed selected model IDs are stripped exactly once before OpenClaw provider and default-model synchronization.
  - Existing models.providers rows remain merged by exact ID so model capability metadata is not deleted.
  - Custom provider multi-model picker behavior remains unchanged.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: false
---

## Background

OpenClaw provider synchronization intentionally retains existing model rows to
preserve capability metadata. Provider account snapshots copy those rows into
`metadata.customModels`, but the chat picker previously treated that historical
list as authoritative even after an OAuth account's selected model changed.

## Scope

- Make the explicit OAuth account model authoritative for chat picker options.
- Normalize a matching runtime-provider prefix before runtime configuration writes.
- Preserve custom-provider multi-model options and OpenClaw model-row metadata.
- Cover the visible picker behavior with Electron E2E.

## Out Of Scope

- Deleting historical model capability rows from `openclaw.json`.
- Removing independently configured custom provider accounts.
- Changing OAuth login defaults.

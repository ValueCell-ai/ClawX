---
id: disable-provider-model-id-edit
title: Prevent editing provider model IDs
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent stale runtime model IDs by making an existing provider's model ID immutable and telling users to recreate the provider when they need a different ID.
touchedAreas:
  - harness/specs/tasks/disable-provider-model-id-edit.md
  - harness/specs/tasks/fix-api-key-model-picker-stale-id.md
  - harness/specs/rules/provider-model-selection-authority.md
  - src/components/settings/ProvidersSettings.tsx
  - src/lib/model-options.ts
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/model-options.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
expectedUserBehavior:
  - The model ID remains configurable while adding a provider.
  - The model ID field is disabled when editing an existing provider.
  - A localized hint tells users to delete and recreate the provider to use another model ID.
  - Saving edits to other provider fields never submits a model ID change.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - provider-model-selection-authority
  - ui-i18n-design-tokens
requiredTests:
  - tests/unit/model-options.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Existing provider model ID inputs are disabled for every provider type.
  - Code Plan edit controls cannot indirectly change the model ID.
  - The edit save payload cannot include a model update.
  - The explanatory hint has complete en, zh, ja, and ru translations.
  - Focused tests and harness validation pass.
docs:
  required: false
---

## Scope

- Disable the model ID field in the existing-provider edit form.
- Prevent edit-save logic and Code Plan controls from changing the model ID.
- Display a short localized recreation hint.
- Keep model ID entry unchanged in the add-provider flow.

## Out Of Scope

- Migrating historical model IDs already written to OpenClaw.
- Changing provider creation or deletion behavior.
- Adding a model-ID migration workflow.

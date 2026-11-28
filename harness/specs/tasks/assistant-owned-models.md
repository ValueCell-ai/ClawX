---
id: assistant-owned-models
title: Keep model services as a catalog and choose models per assistant
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Remove global-default model UI, choose explicit models for newly created assistants, and preserve existing inheritance without migrations.
touchedAreas:
  - src/components/settings/**
  - src/pages/Models/index.tsx
  - src/components/common/ModelPicker.tsx
  - src/pages/Agents/**
  - src/stores/agents.ts
  - shared/host-api/contract.ts
  - electron/services/agents-api.ts
  - electron/utils/agent-config.ts
  - shared/i18n/locales/*/settings.json
  - shared/i18n/locales/*/setup.json
  - shared/i18n/locales/*/agents.json
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - AI Models manages provider connections and configured model lists without a global-default picker or default service badges.
  - The standard page header and icon tabs remain; panels retain their explanatory subtitles without repeating the tab title or icon.
  - Voice and image configuration actions sit inside saved-summary rows; provider creation remains next to its explanatory subtitle.
  - Provider rows expose compact edit and delete icon buttons directly with localized tooltips and keyboard access, without an overflow menu.
  - Assistant creation includes the shared grouped model picker and saves an explicitly selected model as part of creation.
  - Existing assistants display their current effective model, including inherited and unavailable model references, without rewriting configuration.
  - Only deliberate assistant model selection changes that assistant configuration; there is no follow-global or reset-to-global action in the UI.
  - New and existing assistant model controls reuse ModelPicker with provider groups, model icons and Radix focus and motion behavior.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - models-configuration-experience
  - model-selection-scopes
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/unit/agents-page.test.tsx
  - tests/unit/agents-store.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/agents-workspace-experience.spec.ts
acceptance:
  - No migration, startup backfill, bulk model writes or deletion of native agents.defaults.model is introduced.
  - Existing explicit model blocks, fallbacks, unknown fields and task model overrides remain intact.
  - Merely opening or cancelling either page never writes model configuration or creates assistants.
  - Existing host clients and Main-owned config delivery handle explicit creation and model changes.
  - Four locales and bounded dialogs remain usable in narrow and dark layouts.
docs:
  required: true
---

Keep legacy inheritance readable. An inherited effective model is display state, not permission to write an explicit model. Existing clients may still omit the optional creation model; the ClawX creation UI requires a concrete configured choice.

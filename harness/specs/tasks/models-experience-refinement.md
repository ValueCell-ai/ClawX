---
id: models-experience-refinement
title: Clarify model configuration and preserve usage browsing state
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Refine model management and make global defaults, Agent model settings and task-local selections distinct, durable and truthful.
touchedAreas:
  - src/pages/Models/**
  - src/components/settings/**
  - src/components/common/ModelPicker.tsx
  - src/pages/Chat/**
  - src/stores/**
  - src/lib/**
  - shared/host-api/**
  - shared/acp-chat/**
  - shared/chat/**
  - electron/services/**
  - electron/utils/openclaw-auth.ts
  - shared/i18n/locales/*/settings.json
  - shared/i18n/locales/*/dashboard.json
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/agents.json
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The standard management header stays aligned and usage is accessible in a same-level tab.
  - Service rows expose readable names, hosts and model summaries; actual global default model and unset states remain explicit.
  - Editing presents configured models as a read-only list separate from the default summary; creation clearly accepts a single model ID without comma-separated syntax.
  - Add and edit configuration use consistent shared dialog and field patterns with localized labels, clear actions and focus return.
  - Voice and image settings expose current configuration status before editing, with diagnostics in advanced sections.
  - Automatic usage refresh retains valid pagination, filters and reading position; content dialogs support Escape and focus containment.
  - The global default picker selects an explicit configured model and verifies the saved runtime default before reporting success.
  - Global and task model controls reuse the same ModelPicker with provider groups, model icons, compact rows, selection indicators and Radix motion.
  - Agent details configure an Agent-specific model or inheritance; the composer only changes its own task and never writes Agent configuration.
  - Task model choices survive navigation and runtime reloads without leaking into other tasks or creating conversations merely by browsing a draft.
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
  - tests/unit/models-page.test.tsx
  - tests/unit/model-default-summary.test.tsx
  - tests/unit/asr-settings.test.tsx
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/image-generation-settings.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/unit/chat-session-model.test.ts
  - tests/unit/model-selection-service.test.ts
  - tests/unit/acp-chat-store.test.ts
acceptance:
  - Existing API-key validation, OAuth, local services, fallback settings and image auth semantics remain intact.
  - Model IDs and runtime provider identities are not changed or remapped by this UI refinement.
  - Actual saved defaults are distinguished from assistant and per-conversation overrides; absent model metadata is not invented.
  - Configuration requests use existing host-api clients and preserve secret-handling and read-only boundaries.
  - All four locales and desktop/narrow layouts retain usable controls and bounded dialogs.
docs:
  required: true
---

See harness/reference/chat-workspace-and-navigation.md for ownership and existing provider lifecycle tests for compatibility behavior.

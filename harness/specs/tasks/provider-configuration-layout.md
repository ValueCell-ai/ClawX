---
id: provider-configuration-layout
title: Refine provider list and configuration dialogs
scenario: chat-workspace-and-navigation
taskType: ui
intent: Make provider configuration easier to discover and complete without changing model IDs, validation or storage.
touchedAreas:
  - src/components/settings/ProvidersSettings.tsx
  - src/components/settings/AsrSettings.tsx
  - src/components/settings/ImageGenerationSettings.tsx
  - src/pages/Models/index.tsx
  - shared/i18n/locales/*/dashboard.json
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/image-generation-settings.spec.ts
  - shared/i18n/locales/*/settings.json
  - tests/e2e/provider-lifecycle.spec.ts
expectedUserBehavior:
  - Provider cards separate names, model IDs and credential metadata.
  - Set default is visible on non-default providers; editing and deletion use an accessible menu.
  - Provider selection directly lists available providers and prioritizes Custom.
  - Compact forms retain a visible submit action outside the scrolling content.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
requiredTests:
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/image-generation-settings.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - All model configuration tabs use consistent icons, controls and card surfaces.
  - Token usage uses a compact accessible table preserving status, pagination and individual cache metrics.
  - Background refresh retains records without displaying the initial loading message.
  - Existing provider availability, credential validation, OAuth and default selection behavior is preserved.
  - English, Chinese, Japanese and Russian labels cover new controls.
  - Narrow-window form submission remains visible without scrolling the footer.
docs:
  required: true
---

Presentation and local filtering only. Existing Host API operations remain unchanged; no backend communication paths are introduced or modified.

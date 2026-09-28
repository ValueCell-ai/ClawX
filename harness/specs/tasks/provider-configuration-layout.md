---
id: provider-configuration-layout
title: Refine provider list and configuration dialogs
scenario: chat-workspace-and-navigation
taskType: ui
intent: Make provider configuration easier to discover and complete without changing model IDs, validation or storage.
touchedAreas:
  - src/components/settings/ProvidersSettings.tsx
  - shared/i18n/locales/*/settings.json
  - tests/e2e/provider-lifecycle.spec.ts
expectedUserBehavior:
  - Provider cards separate names, model IDs and credential metadata.
  - Editing is always visible and secondary actions use an accessible menu.
  - Provider selection supports search and prioritizes Custom.
  - Compact forms retain a visible submit action outside the scrolling content.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
requiredTests:
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Existing provider availability, credential validation, OAuth and default selection behavior is preserved.
  - English, Chinese, Japanese and Russian labels cover new controls and empty search state.
  - Narrow-window form submission remains visible without scrolling the footer.
docs:
  required: true
---

Presentation and local filtering only. Existing Host API operations remain unchanged; no backend communication paths are introduced or modified.

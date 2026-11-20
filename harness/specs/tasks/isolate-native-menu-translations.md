---
id: isolate-native-menu-translations
title: Keep UI translation changes from restarting Electron during development
scenario: chat-workspace-and-navigation
taskType: ui
intent: Decouple native menu translation dependencies and update renderer translations through Vite HMR without restarting Electron or losing interface state.
touchedAreas:
  - shared/i18n/**
  - electron/main/menu.ts
  - src/i18n/**
  - src/pages/Agents/index.tsx
  - tests/unit/menu.test.ts
  - tests/unit/i18n-hot-reload.test.ts
  - harness/specs/tasks/isolate-native-menu-translations.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Changes to page locale JSON update rendered text without restarting Electron or the OpenClaw Gateway.
  - Translations for each namespace and language remain synchronized without changing the current language or losing component state.
  - Native menu translations retain their existing behavior and may rebuild the Electron main process when changed.
requiredProfiles:
  - fast
requiredRules:
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/menu.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/i18n-hot-reload.test.ts
acceptance:
  - Main imports only native menu translation files, not unrelated renderer namespace JSON.
  - HMR replaces changed resource bundles including deleted keys and notifies React listeners once while preserving current language.
  - Extension translation additions and overrides survive HMR in registration order; static locale modules are not mutated by extension merges.
  - Production retains its existing static translation initialization and menu behavior.
docs:
  required: true
---

Renderer translations and native menu labels share source locale JSON but use separate dependency entry points. Do not disable main or preload watchers globally.

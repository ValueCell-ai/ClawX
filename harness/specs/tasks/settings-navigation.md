---
id: settings-navigation
title: Task-oriented navigation and categorized settings
scenario: chat-workspace-and-navigation
taskType: ui-refactor
intent: Put configuration in categorized settings, combine assistant and skill discovery, and replace internal terminology in user-facing navigation while preserving existing capabilities and deep links.
touchedAreas:
  - src/App.tsx
  - src/pages/Settings/**
  - src/pages/Models/index.tsx
  - src/pages/Channels/index.tsx
  - src/pages/ComputerUse/index.tsx
  - src/pages/Agents/index.tsx
  - src/pages/Skills/index.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/CapabilitiesNavigation.tsx
  - src/pages/Chat/ChatInput.tsx
  - shared/i18n/locales/**
  - tests/e2e/**
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The sidebar offers new tasks, assistants and skills, AI models, messaging remote control, scheduled tasks, computer operation, conversations, and settings.
  - App settings separates general preferences, advanced tools, and help/about; capability configuration is accessed directly in the sidebar.
  - Legacy model/channel/computer routes and developer section links remain usable, including model tab query parameters.
  - Developer-only controls stay gated; moving a control never grants permissions or enables it.
requiredProfiles:
  - fast
requiredRules:
  - settings-navigation
  - ui-i18n-design-tokens
  - renderer-main-boundary
  - docs-sync
requiredTests:
  - tests/e2e/settings-navigation.spec.ts
  - tests/e2e/main-navigation.spec.ts
  - tests/e2e/developer-mode.spec.ts
  - tests/e2e/management-page-style.spec.ts
  - tests/unit/i18n-locale-parity.test.ts
acceptance:
  - Only the selected settings category renders its configuration controls, with contained scrolling at desktop and narrow sizes.
  - Every category is keyboard-accessible and the selected category is indicated independently of color.
  - All four locales provide the new navigation labels and descriptions; skill names and descriptions are unchanged.
  - Configuration and permission behavior continue through existing host APIs; gateway-backend-communication remains the runtime boundary reference.
docs:
  required: true
---

This is a navigation and presentation change. Existing host API operations are reused;
no transport, credentials, permission semantics, or runtime protocols change. See
`harness/specs/scenarios/gateway-backend-communication.md` for the unchanged runtime contract.

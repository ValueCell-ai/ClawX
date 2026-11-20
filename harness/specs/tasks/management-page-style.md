---
id: management-page-style
title: Align management pages with the Skills visual style
scenario: chat-workspace-and-navigation
taskType: ui
intent: Unify Models, Agents, Channels, Cron, Settings and Computer Use typography, gutters and cards using the accepted Skills page style.
touchedAreas:
  - src/pages/Settings/index.tsx
  - src/pages/ComputerUse/index.tsx
  - src/pages/Models/index.tsx
  - src/pages/Agents/index.tsx
  - src/pages/Channels/index.tsx
  - src/pages/Cron/index.tsx
  - src/components/settings/ProvidersSettings.tsx
  - src/components/settings/AsrSettings.tsx
  - src/components/settings/ImageGenerationSettings.tsx
  - src/styles/globals.css
  - tests/e2e/management-page-style.spec.ts
expectedUserBehavior:
  - All management pages use compact system typography and consistent page width and padding.
  - Cards and section headings share a restrained visual style while preserving controls.
  - Content scrolls within the available height without duplicated bottom gutters.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
requiredTests:
  - tests/e2e/management-page-style.spec.ts
  - tests/e2e/cron-card-long-title.spec.ts
acceptance:
  - Desktop and narrow dark screenshots show 24px medium-weight page headings and 32px padding.
  - Existing business logic, translations and backend communication are unchanged.
docs:
  required: true
---

Presentation only. The Skills page is the accepted reference; keep the original skill data and existing management actions intact.

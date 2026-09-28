---
id: skills-card-layout
title: Compact Skills cards and discovery navigation
scenario: chat-workspace-and-navigation
taskType: ui
intent: Improve skill browsing and details without replacing skill names or descriptions or adding chat actions.
touchedAreas:
  - src/pages/Skills/index.tsx
  - shared/i18n/locales/*/skills.json
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - src/styles/globals.css
expectedUserBehavior:
  - Original skill names and descriptions appear in responsive cards.
  - My skills and Discover skills separate management and existing marketplace search.
  - Discovery and Add skills are hidden for unsupported capability without searching.
  - Keyboard-accessible details preserve file previews and paths in an always-visible read-only section without management actions.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
requiredTests:
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - tests/e2e/skills-gateway-readiness.spec.ts
acceptance:
  - Names and descriptions are not translated through aliases and no use-skill action is added.
  - Cards have named switches and semantic detail buttons without nested interactive controls.
  - All new copy covers English, Chinese, Japanese and Russian.
docs:
  required: true
---

Presentation-only update; existing Host API capability/search/install and skill state routes remain unchanged. The gateway-backend-communication boundary still applies; no transport or backend changes are introduced.

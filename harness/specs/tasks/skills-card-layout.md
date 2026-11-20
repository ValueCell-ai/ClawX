---
id: skills-card-layout
title: Compact Skills cards and discovery navigation
scenario: chat-workspace-and-navigation
taskType: ui
intent: Improve skill browsing and details without replacing skill names or descriptions or adding chat actions.
touchedAreas:
  - src/pages/Skills/index.tsx
  - src/pages/Agents/index.tsx
  - src/components/layout/**
  - shared/i18n/locales/*/skills.json
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/e2e/**
  - tests/unit/skills-page-gateway-readiness.test.tsx
  - src/styles/globals.css
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Original skill names and descriptions appear in responsive cards.
  - Skills and Assistants have independent sidebar entries and standard management page headers without duplicate in-page navigation; search and status filters form the only Skills toolbar.
  - Cards show original names, descriptions and compact source badges with independent switches; version metadata remains in details.
  - Add skills opens existing marketplace search in a dismissible dialog without replacing the local list or its filters.
  - Discovery and Add skills are hidden for unsupported capability without searching.
  - Centered details use the shared Dialog, bounded internal scrolling and focus return to the opening card; skill files open in a right drawer reusing the Workspace reader and return focus to the selected file when closed.
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

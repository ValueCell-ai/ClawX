---
id: converge-ui-design
title: Converge application UI on the design contract
scenario: chat-workspace-and-navigation
taskType: ui
intent: Establish and apply project-wide UI rules for layouts, surfaces, controls and typography while preserving interaction behavior.
touchedAreas:
  - src/pages/Chat/**
  - src/pages/Agents/**
  - src/pages/Skills/**
  - src/pages/Cron/**
  - src/pages/Channels/**
  - src/pages/Settings/**
  - src/components/layout/Sidebar.tsx
  - src/components/file-preview/**
  - src/components/settings/**
  - src/components/skills/**
  - src/components/channels/**
  - src/components/ui/**
  - src/styles/globals.css
  - src/pages/Setup/**
  - tests/e2e/channels-account-id-validation.spec.ts
  - tests/e2e/app-smoke.spec.ts
  - tests/e2e/settings-issue-report.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/unit/acp-session-plan.test.tsx
  - tests/unit/acp-subagent-sessions.test.tsx
  - tests/e2e/chat-subagent-sessions.spec.ts
  - DESIGN.md
  - AGENTS.md
  - tailwind.config.js
  - harness/specs/rules/ui-i18n-design-tokens.md
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/agents-workspace-experience.spec.ts
  - tests/e2e/cron-skill-picker.spec.ts
  - tests/e2e/channels-health-diagnostics.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/task-sidebar-search-and-pins.spec.ts
  - tests/e2e/skills-gateway-readiness.spec.ts
  - harness/specs/tasks/converge-ui-design.md
expectedUserBehavior:
  - The task composer uses comfortable reading typography and skill tokens remain aligned with the text caret.
  - Selector instructions, task metadata, skill sources and configuration help remain legible without unnecessary visual density.
  - Navigation, selection, settings and file preview interactions preserve their existing behavior.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
  - settings-navigation
  - docs-sync
requiredTests:
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/task-sidebar-search-and-pins.spec.ts
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/e2e/management-page-style.spec.ts
acceptance:
  - The composer and its transparent skill highlight layer use the same 16px font size and 26px line height.
  - Sidebar task timestamps and skill source badges are at least 12px and remain aligned and accessible.
  - Picker instructions and configuration help use readable body typography; numeric indicators retain compact sizing where appropriate.
  - Desktop, narrow and dark UI retains usable controls and bounded scrolling; no product data or persistence behavior changes.
  - Collection layout, controls and passive badge behavior follow the project design contract.
  - Filled primary actions and user-message text meet 4.5:1 contrast in light and dark themes; actions also meet it on hover.
  - Assistant creation uses the shared bounded configuration dialog and its footer submit control remains reachable.
  - Task-plan and subagent popovers use the shared Radix layer and support Escape and focus return.
docs:
  required: false
---

Apply the roles and collection, action, and badge guidance in [DESIGN.md](../../../DESIGN.md) by purpose, keeping
user-authored content and numeric micro-indicators in their appropriate contexts.

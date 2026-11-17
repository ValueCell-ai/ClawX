---
id: refine-assistant-details-tabs
title: Organize assistant details around overview, files and capabilities
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Implement the approved assistant demo with native configuration editing, shared file previews and an honest workspace skill overview.
touchedAreas:
  - src/pages/Agents/**
  - src/components/common/ModelPicker.tsx
  - src/pages/Channels/index.tsx
  - src/components/channels/ChannelLogo.tsx
  - shared/i18n/locales/*/agents.json
  - tests/e2e/agents-workspace-experience.spec.ts
  - tests/unit/agents-page.test.tsx
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Assistant cards expose management and start-task actions without invented descriptions or activity.
  - A bounded details dialog separates overview, profile files and skills with shared Radix tabs.
  - Name, model and full SOUL.md editing keep existing save, conflict and unsaved-change protection.
  - Assistant models are selected from configured options; an existing external model remains visible and unchanged until an explicit selection.
  - Starting a task from details preserves drafts and uses the selected assistant and workspace without sending.
  - Skills are loaded on demand through the existing workspace quick-access API, not presented as an authoritative tool-permission report.
  - File previews reuse the shared Workspace reader drawer and return focus to the opener.
requiredProfiles:
  - fast
requiredRules:
  - assistant-workspace-identity
  - shared-file-reader
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/e2e/agents-workspace-experience.spec.ts
  - tests/unit/agents-page.test.tsx
acceptance:
  - No new transport, runtime configuration or migration is introduced.
  - Missing skills and read failures have localized states; tools and sandbox are never guessed from the skill list.
  - Tabs preserve unsaved drafts; leaving the dialog or starting a task retains existing discard confirmation.
  - All labels support en, zh, ja and ru and the dialog remains bounded in narrow windows.
docs:
  required: true
---

Uses DESIGN.md's content-reader width exception for a two-column assistant detail surface.
Validation execution is deferred for the user's rapid UI iteration request; dev startup and MCP connection are required for visual review.

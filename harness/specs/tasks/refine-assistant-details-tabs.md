---
id: refine-assistant-details-tabs
title: Organize assistant details around overview and files
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Provide native configuration editing and shared file previews in assistant details.
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
  - A bounded details dialog separates overview and profile files with shared Radix tabs.
  - Name and model are staged in the overview and saved through the footer; full SOUL.md editing remains separately saved with conflict and unsaved-change protection.
  - Assistant models are selected from configured options; an existing external model remains visible and unchanged until an explicit selection.
  - Starting a task from the assistant list preserves drafts and uses the selected assistant and workspace without sending.
  - Skills remain managed on the dedicated skills page; assistant details do not present a workspace scan as effective agent permissions.
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
  - File read failures have localized states; tools and sandbox are never guessed from a skill list.
  - Tabs preserve unsaved drafts; leaving the dialog retains existing discard confirmation.
  - All labels support en, zh, ja and ru and the dialog remains bounded in narrow windows.
docs:
  required: true
---

The overview uses compact labeled rows; profile files remain in their own tab.

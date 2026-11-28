---
id: separate-startup-chat-draft
title: Keep the startup task separate from OpenClaw's main conversation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Start ClawX with an independent local draft and load persisted conversations only when selected.
touchedAreas:
  - harness/specs/tasks/separate-startup-chat-draft.md
  - harness/specs/tasks/show-acp-context-usage.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/**
  - docs/*/features.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Startup opens a blank new task even when OpenClaw already has a main conversation or the session catalog is unavailable.
  - A draft stays local until its first send, which creates and prompts a distinct task session.
  - Selecting the previous main conversation in the sidebar still replays its history and shows its own context usage.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-startup-acp-placeholder.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - A failed catalog fetch and its successful retry preserve the same selected local draft.
  - Blank startup does not load an ACP session or display a context meter.
  - The first prompt's load uses createIfMissing on the draft key; selecting the old main key loads existing history without createIfMissing.
docs:
  required: true
---

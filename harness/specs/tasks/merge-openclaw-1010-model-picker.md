---
id: merge-openclaw-1010-model-picker
title: Integrate upstream conversation selection into the grouped model picker
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Merge the OpenClaw 2026.10.10 upgrade and first-message model selection changes without replacing the shared Radix composer or assistant creation UI.
touchedAreas:
  - .gitattributes
  - AGENTS.md
  - README*.md
  - electron-builder.yml
  - electron/**
  - harness/**
  - package.json
  - patches/**
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - resources/cli/**
  - scripts/**
  - shared/i18n/locales/*/chat.json
  - src/App.tsx
  - src/components/common/ModelPicker.tsx
  - src/extensions/registry.ts
  - src/pages/Chat/**
  - src/stores/cron.ts
  - src/stores/gateway.ts
  - tests/**
expectedUserBehavior:
  - The shared Radix picker groups concrete models by provider and marks the effective model, including an inherited default.
  - Selecting the inherited model pins it explicitly, while opening the menu leaves inheritance intact.
  - Models selected in unsent drafts apply before the first prompt. A deleted existing conversation cannot be recreated by selecting a model.
  - Switching the execution assistant and routing a message to another assistant retain their existing behaviors.
  - Creating an assistant with a selected model and instructions works with the upgraded OpenClaw auth database.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-model-selection-authority
  - model-selection-scopes
  - openclaw-upgrade-persistence
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/chat-execution-agent.spec.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
acceptance:
  - Keep shared menu density, model icons, keyboard interactions, and the workspace footer.
  - Preserve first-prompt ordering, retained drafts after failed writes, and per-conversation routing and overrides.
  - Exercise the OpenClaw 2026.10.10 assistant creation flow in an isolated Electron fixture.
docs:
  required: true
---

See [Conversation model selection](../../reference/acp-chat.md#conversation-model-selection)
and [OpenClaw 2026.10.10 upgrade](../../reference/openclaw-2026-10-10-upgrade.md).

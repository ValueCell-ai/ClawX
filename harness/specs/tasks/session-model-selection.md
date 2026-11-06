---
id: session-model-selection
title: Select the model for an individual conversation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply the chat model picker to the selected OpenClaw session and inherit the Agent configuration for sessions without an explicit selection.
touchedAreas:
  - harness/specs/tasks/session-model-selection.md
  - harness/reference/acp-chat.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/provider-model-selection-authority.md
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/session-model.ts
  - src/stores/composer-drafts.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/providers.ts
  - src/extensions/types.ts
  - shared/i18n/locales/**
  - shared/chat/types.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/unit/provider-store-init.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Selecting a model affects subsequent turns in just the selected conversation, including its first turn in a new workspace.
  - Following the Agent uses its current model and retains existing 0.6.1 Agent and enterprise preferences on upgrade.
  - An explicitly selected model survives reopening the conversation. A sibling chat can use a different model in the same workspace or another workspace.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-model-selection-authority
  - openclaw-upgrade-persistence
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - The Main-owned session model mutation identifies the exact session, supports inheritance, and precedes the affected prompt.
  - Existing Agent choices and session overrides survive upgrade; historical model usage never becomes a user preference.
  - A failed selection or an in-flight update during navigation cannot apply a model to a different session.
  - Enterprise reauthentication preserves allowed choices and enforces current policy before dispatch.
docs:
  required: true
---

## Verification

Exercise two sibling chats, explicit selection and inheritance, an unsent draft, and recovery after a failed write. Verify persisted enterprise preferences using an isolated account policy.

See [Conversation model selection](../../reference/acp-chat.md#conversation-model-selection).

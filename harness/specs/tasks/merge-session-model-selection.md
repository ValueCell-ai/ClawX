---
id: merge-session-model-selection
title: Integrate conversation model selection with the ClawX composer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply the chat model picker to the selected OpenClaw session and inherit the Agent configuration for sessions without an explicit selection.
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - electron/gateway/config-delivery.ts
  - electron/gateway/manager.ts
  - electron/services/channels-api.ts
  - electron/services/chat-api.ts
  - electron/services/model-selection-service.ts
  - electron/services/sessions-api.ts
  - electron/utils/agent-config.ts
  - electron/utils/openclaw-agent-roster.ts
  - electron/utils/openclaw-legacy-agent-roles.ts
  - electron/utils/openclaw-workspace.ts
  - harness/reference/acp-chat.md
  - harness/reference/local-061-upgrade-validation.md
  - harness/reference/openclaw-config-delivery.md
  - harness/specs/rules/model-selection-scopes.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/rules/provider-model-selection-authority.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/fix-061-upgrade-workspace-consistency.md
  - harness/specs/tasks/limit-gateway-stall-amplification.md
  - harness/specs/tasks/merge-session-model-selection.md
  - harness/specs/tasks/retry-rolled-back-config-publication.md
  - harness/specs/tasks/session-model-selection.md
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - src/components/common/ModelPicker.tsx
  - src/extensions/types.ts
  - src/lib/host-api.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/session-model.ts
  - src/stores/acp-chat-session.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/chat/session-key-utils.ts
  - src/stores/composer-drafts.ts
  - src/stores/providers.ts
  - src/stores/task-models.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
  - tests/e2e/chat-execution-agent.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-session-model.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/model-selection-service.test.ts
  - tests/unit/openclaw-agent-roster.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-legacy-agent-roles.test.ts
  - tests/unit/openclaw-workspace.test.ts
  - tests/unit/provider-store-init.test.ts
  - tests/unit/session-model-selection.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/strip-first-run.test.ts
expectedUserBehavior:
  - The composer preserves grouped model icons, keyboard selection, and the execution Agent selector that starts a new task with its existing draft.
  - Selecting a model affects subsequent turns in just the selected conversation, including its first turn in a new workspace.
  - Following the Agent uses its current model and retains existing 0.6.1 Agent and enterprise preferences on upgrade.
  - An explicitly selected model survives reopening the conversation. A sibling chat can use a different model in the same workspace or another workspace.
  - Selecting an @Agent shows and edits the receiving Agent's main session model. Removing the mention restores the source session's selection.
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
  - The Main-owned session model mutation identifies the exact session, supports inheritance, and precedes the affected prompt.
  - Existing Agent choices and session overrides survive upgrade; historical model usage never becomes a user preference.
  - A failed selection or an in-flight update during navigation cannot apply a model to a different session.
  - A routed model selection reads the exact Gateway destination even when it is absent from the sidebar. A confirmed new destination keeps its choice until its first prompt.
  - Enterprise reauthentication preserves allowed choices and enforces current policy before dispatch.
docs:
  required: true
---

## Verification

Exercise two sibling chats, explicit selection and inheritance, an unsent draft, and recovery after a failed write. Verify persisted enterprise preferences using an isolated account policy.

See [Conversation model selection](../../reference/acp-chat.md#conversation-model-selection).

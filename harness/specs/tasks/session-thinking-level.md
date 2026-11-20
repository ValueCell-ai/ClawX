---
id: session-thinking-level
title: Select model-aware thinking levels in the composer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose the destination session's OpenClaw thinking profile and persist explicit choices through the Gateway.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - electron/shared/providers/model-compat.ts
  - tests/unit/deepseek-thinking-runtime.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - electron/gateway/config-delivery.ts
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/services/sessions-api.ts
  - shared/host-api/contract.ts
  - src/pages/Chat/ThinkingStrengthPicker.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/session-model.ts
  - src/stores/composer-drafts.ts
  - src/lib/host-api.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - tests/unit/session-model-selection.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
  - harness/specs/rules/provider-model-selection-authority.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/session-thinking-level.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Dragging previews each stop and releasing commits the selected level. A single available level is shown as a button.
  - The picker offers the levels advertised for the destination model and supports restoring its default.
  - First-prompt choices remain local until dispatch.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-model-selection-authority
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/deepseek-thinking-runtime.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Enterprise DeepSeek V4.1 Flash and its 1017 alias send an explicit DeepSeek toggle and the selected native effort, including max followed by off in an existing conversation.
  - Existing provider rows migrate idempotently. Replacing, removing or signing back into a provider does not restore removed models or leak model settings to another account.
  - ClawX delivers the GPT-6.2 Astra Responses profile for configured OpenAI-compatible routes, including existing custom models.
  - Binary display labels use the canonical option ID on write.
  - Missing capabilities never cause the composer to invent selectable levels.
  - Model and thinking overrides are applied together on first send.
docs:
  required: true
---

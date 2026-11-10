---
id: remove-follow-agent-model-option
title: Show concrete models in the conversation model picker
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the Follow Agent option from the conversation model picker while preserving existing session selections and implicit Agent defaults.
touchedAreas:
  - harness/specs/tasks/remove-follow-agent-model-option.md
  - harness/specs/tasks/fix-auth-readiness-fixture-timeout.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/provider-model-selection-authority.md
  - harness/reference/acp-chat.md
  - src/pages/Chat/ChatInput.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/chat-input.test.tsx
  - tests/unit/openclaw-auth-readiness.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The conversation model menu lists concrete configured models and marks the effective model when it is available in the menu.
  - Conversations without an explicit model continue to use the Agent default without exposing a separate Follow Agent option.
  - Selecting a concrete model applies it only to the destination conversation, even when it matches the currently inherited default.
  - Existing selections, unsent draft choices, sibling conversation isolation, and Agent mention routing retain their behavior.
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
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/session-model-selection.test.ts
  - tests/unit/openclaw-auth-readiness.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - No Follow Agent menu entry or fallback label remains in the composer or any chat locale.
  - The menu selected state follows the effective model for inherited and explicitly selected sessions without writing a preference merely by opening the menu.
  - An existing explicit model remains visible when no configured options are available, with the picker disabled instead of opening an empty menu.
  - Clicking the inherited concrete model persists an explicit session choice; clicking another model never clears the choice or changes Agent configuration.
  - Rejected updates preserve the current selection, reopening retains an explicit choice, and sibling conversations keep their own effective model.
  - A local draft retains its selection until first send and an Agent mention directs model selection to the receiving Agent main session.
  - Focused unit and Electron E2E checks, harness validation, communication replay, and communication comparison pass.
docs:
  required: true
---

## Scope

Simplify the existing conversation picker without changing the Main-owned session
model API, OpenClaw inheritance semantics, or upgrade migration. Keep inherited
sessions implicit until the user selects a concrete model. Reuse the localized
model-selection prompt when no concrete current model is known.

## Verification

Exercise inherited and explicit selections, selecting the inherited model itself,
failed writes, sibling navigation, reload, local drafts, and Agent mention routing.
Confirm the menu has no inheritance action and makes no automatic model writes.
After automatic ACP preparation, verify that choosing a concrete model still
applies before the first prompt while a deleted existing conversation is not
recreated. Preserve the upstream first-message selection fix.

The CI follow-up retains full-file auth readiness checks using native byte
equality; see [Auth readiness test budget](fix-auth-readiness-fixture-timeout.md).

See [Conversation model selection](../../reference/acp-chat.md#conversation-model-selection).

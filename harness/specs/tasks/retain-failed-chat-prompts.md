---
id: retain-failed-chat-prompts
title: Keep rejected chat prompts available for retry
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve submitted text when an extension rejects a send, session preparation fails, or ACP fails after dispatch.
touchedAreas:
  - src/pages/Chat/**
  - src/stores/composer-drafts.ts
  - src/stores/chat.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/chat/session-key-utils.ts
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A failed submission displays its original prompt and a visible error in its conversation.
  - Returning from sign-in allows the user to submit again with the usual authorization checks.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-session-management.test.ts
  - tests/unit/composer-drafts.test.ts
  - tests/unit/session-key-utils.test.ts
  - tests/e2e/chat-failed-prompts.spec.ts
acceptance:
  - Blocked and failed submissions preserve the prompt without overwriting newer input.
  - A retry requires user action and passes through the same extension and session admission checks.
  - Navigation and catalog refresh retain failed local conversations, and explicit deletion discards their pending submissions.
  - Successful sends and conversation history keep their existing ACP ownership.
docs:
  required: true
---

Keep failed submissions scoped to their conversation in the renderer so returning from a login route can recover them.

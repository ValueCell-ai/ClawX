---
id: merge-071-chat-controls
title: Integrate upstream ClawX 0.7.1 chat changes
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Merge upstream session readiness, thinking controls, prompt recovery and background image results into the existing Lexical composer and conversation sidebar.
touchedAreas:
  - .github/workflows/check.yml
  - README*.md
  - harness/**
  - package.json
  - pnpm-lock.yaml
  - patches/openclaw@2026.10.10.patch
  - scripts/**
  - shared/i18n/locales/*/chat.json
  - src/components/layout/Sidebar.tsx
  - src/lib/acp/**
  - src/pages/Chat/**
  - src/stores/acp-chat-session.ts
  - src/stores/chat.ts
  - src/stores/chat/**
  - src/stores/composer-drafts.ts
  - src/stores/gateway.ts
  - tests/**
expectedUserBehavior:
  - New tasks start with an independent draft. Returning to an existing conversation waits for Gateway readiness before loading history.
  - The grouped model selector and model-aware thinking controls apply to the session receiving the next message.
  - Failed submissions stay visible in their conversation and can be retried with their original attachments.
  - A background image task stays visible as in progress until its result arrives, including when settled replay advances past the live notification.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - provider-model-selection-authority
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/composer-drafts.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/e2e/chat-failed-prompts.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/gateway-lifecycle.spec.ts
acceptance:
  - Opening ClawX leaves the previous main conversation untouched. An existing conversation restores when a delayed Gateway catalog becomes ready.
  - Before the first prompt the destination receives both model and thinking choices. A failed model write blocks dispatch to avoid using the wrong model.
  - A queued or failed submission prevents its local session from being pruned. Explicit deletion clears text, Lexical state, attachments and pending selections together.
  - Transcript recovery of a pending generation task is limited to a verified image tool result in the current user turn.
docs:
  required: true
---

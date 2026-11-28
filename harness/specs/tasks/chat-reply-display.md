---
id: chat-reply-display
title: Concise and detailed conversation replies
scenario: acp-chat-experience
taskType: ui-refactor
intent: Keep the answer visible while making completed tool activity available on demand.
touchedAreas:
  - DESIGN.md
  - README*.md
  - harness/specs/**
  - shared/i18n/locales/**
  - src/lib/acp/timeline-groups.ts
  - src/pages/Chat/**
  - src/pages/Settings/Preferences.tsx
  - src/stores/settings.ts
  - tests/e2e/**
  - tests/unit/**
expectedUserBehavior:
  - Concise is the local default. Detailed keeps the inline timeline and persists across reloads.
  - Each eligible turn can expand its process from the duration label or View process.
  - In the expanded Concise process, each tool opens its own details directly. Detailed keeps consecutive tool calls grouped.
  - Running and unresolved turns and turns without a reply after the last tool stay inline.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/acp-timeline-groups.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
acceptance:
  - Use the ordered ACP tool boundary for completed turns with trailing assistant text.
  - Keep output images, attachments, file activity and actionable errors visible.
  - Reopening the process restores the original timeline order.
docs:
  required: true
---

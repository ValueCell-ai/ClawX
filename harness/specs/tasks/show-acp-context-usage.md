---
id: show-acp-context-usage
title: Show ACP context usage in the chat composer
scenario: acp-chat-experience
taskType: renderer-feature
intent: Surface OpenClaw ACP usage_update values in the ClawX chat composer without adding a parallel Gateway history or transport path.
touchedAreas:
  - harness/specs/tasks/show-acp-context-usage.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - When ACP supplies finite positive usage_update used and size values for the active session, the composer shows a context-usage ring.
  - Hovering or focusing the ring exposes the percentage and used-token/total-token counts.
  - Missing, malformed, or non-positive usage data renders no indicator.
  - The indicator is derived only from the active ACP timeline metadata and does not use a Gateway snapshot or direct Renderer transport.
requiredProfiles:
  - fast
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/chat-input.test.tsx
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --grep "context usage"
acceptance:
  - The ring displays a bounded 0-100 percentage based on used divided by size.
  - The accessible hover/focus label includes the formatted percentage plus used and total token counts.
  - Existing composer behavior remains unchanged when usage metadata is absent.
  - No new Renderer-to-Gateway communication path is added.
docs:
  required: true
---

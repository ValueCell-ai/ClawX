---
id: chat-code-and-list-tools
title: Localize built-in tool cards
scenario: acp-chat-experience
taskType: ui-presentation
intent: Give selected OpenClaw tool families localized action names and icons in live and replayed Chat cards.
touchedAreas:
  - src/pages/Chat/AcpToolCallCard.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - harness/specs/tasks/chat-code-and-list-tools.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - DESIGN.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - exec with a non-empty code argument shows Run code with a code icon; shell-command exec keeps Run command and its current icon.
  - Historical exec titles beginning with code also show Run code when structured input is unavailable.
  - ls shows List files with a file-list icon in live and replayed cards, including collapsed tool groups.
  - File, execution, web, memory and personal instructions, subtask and skill calls use localized action names and icons.
  - Code Mode and Tool Search controls use localized action names and icons. Historical bash and cron calls share the presentations of exec and automations respectively.
  - Full tool input, output, status, ordering and expand/collapse interactions remain available.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
acceptance:
  - Labels are covered in en, zh, ja and ru; malformed or empty exec input does not acquire the code presentation.
  - Valid structured exec input takes precedence over title-only presentation hints.
  - Electron replay coverage includes code and command execution, skill loading, Tool Search, and historical aliases with localized titles, distinct icons and expandable input.
docs:
  required: true
---

The renderer applies the mapping in the existing tool card. The inventory and
coverage are documented in [CHAT-UI-01](../../reference/openclaw-2026-10-5-upgrade.md#chat-ui-01-tool-presentation-coverage).

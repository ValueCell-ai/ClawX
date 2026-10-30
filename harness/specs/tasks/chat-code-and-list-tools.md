---
id: chat-code-and-list-tools
title: Specialize code execution and file listing tool cards
scenario: acp-chat-experience
taskType: ui-presentation
intent: Distinguish OpenClaw exec code calls from shell commands and give ls calls a localized file-listing label and icon without changing tool execution or ACP content.
touchedAreas:
  - src/pages/Chat/AcpToolCallCard.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - harness/specs/tasks/chat-code-and-list-tools.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - exec with a non-empty code argument shows Run code with a code icon; shell-command exec keeps Run command and its current icon.
  - Historical exec titles beginning with code also show Run code when structured input is unavailable.
  - ls shows List files with a file-list icon in live and replayed cards, including collapsed tool groups.
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
  - Electron replay coverage includes code exec, command exec and ls with localized titles, distinct icons and expandable full code input.
docs:
  required: true
---

Presentation-only follow-up to the OpenClaw 2026.10.5 upgrade. The existing
gateway-backend-communication routing and ACP reducer are unchanged.

Remaining tool coverage and semantic UI work are deferred and tracked in
[CHAT-UI-01](../../reference/openclaw-2026-10-5-upgrade.md#chat-ui-01-tool-presentation-coverage).

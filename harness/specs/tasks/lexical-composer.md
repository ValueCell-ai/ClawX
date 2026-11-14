---
id: lexical-composer
title: Replace composer overlays with Lexical skill tokens
scenario: chat-workspace-and-navigation
taskType: ui
intent: Make task composition reliable with atomic skill tokens and a shared Radix slash picker while retaining plain-text prompts and existing composer features.
touchedAreas:
  - src/components/composer/
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Cron/index.tsx
  - src/stores/composer-drafts.ts
  - src/stores/chat.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/
  - tests/e2e/
expectedUserBehavior:
  - A leading slash opens current-agent skills without stealing the editor focus.
  - Skill buttons and the slash picker insert atomic tokens and preserve surrounding text.
  - Drafts, attachments, dictation, previews, IME and send admission retain their existing behavior.
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - tests/unit/composer-editor.test.tsx
  - tests/unit/composer-drafts.test.ts
  - tests/e2e/lexical-composer.spec.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/cron-skill-picker.spec.ts
acceptance:
  - Lexical owns editing, selection and history; no textarea highlight overlay or per-keystroke document rebuild remains.
  - Skill tokens serialize to the existing slash-name plain-text prompt, with no Gateway or OpenClaw protocol change.
  - Shared Radix owns floating presence, collision, dismissal and motion; the contenteditable retains focus during slash selection.
  - Session switching and agent draft transfer preserve document content and tokens; rejected sends retain the draft.
  - Clipboard text and files, multiline input, undo/redo, token deletion, unknown skills, disabled states and four locales are covered.
docs:
  required: true
---

Follow `ui-i18n-design-tokens` and `renderer-main-boundary`. The existing
`gateway-backend-communication` boundary remains unchanged: only the composer
serializer supplies the same plain text to the existing send callback. Do not
add transport, runtime or data migration behavior. Chat and scheduled tasks share
the editor and token implementation, with separate Enter-to-send configuration.

---
id: chat-home-composer
title: Center the new-chat composer and expose installed office skills
scenario: chat-workspace-and-navigation
taskType: ui
intent: Make new tasks easier to start with a centered composer and installed skill shortcuts while preserving drafts and existing send behavior.
touchedAreas:
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/lib/quick-access-skills.ts
  - src/stores/skills.ts
  - shared/i18n/locales/*/chat.json
  - tests/e2e/chat-home-composer.spec.ts
expectedUserBehavior:
  - Empty ordinary chats center a smaller heading, installed office skill shortcuts and composer.
  - Shortcuts insert existing skill tokens without sending or replacing the draft.
  - Workspace and Gateway status share an attached gray footer; model selection sits before dictation and send.
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - tests/unit/quick-access-skills-cache.test.ts
  - tests/e2e/chat-home-composer.spec.ts
acceptance:
  - Existing conversations keep their bottom composer and drafts survive the first message.
  - Four office shortcuts render immediately and remain disabled until availability is known; results are cached per skill context and invalidated after skill changes; no new backend endpoint or direct IPC is introduced.
  - English, Chinese, Japanese and Russian labels and narrow-window layouts are covered.
docs:
  required: true
---

Use the existing skills quick-access Host API under the `gateway-backend-communication` scenario and renderer-main-boundary rule. This task changes presentation and when the existing skill catalog is loaded, not runtime transport, delivery or prompt handling.

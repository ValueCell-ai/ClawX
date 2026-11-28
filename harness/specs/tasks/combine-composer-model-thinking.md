---
id: combine-composer-model-thinking
title: Choose the chat model and thinking strength in one panel
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Combine the current task model and thinking controls while preserving the existing session reads, writes and first-prompt choices.
touchedAreas:
  - DESIGN.md
  - README*.md
  - harness/specs/tasks/combine-composer-model-thinking.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - shared/i18n/locales/*/chat.json
  - src/components/common/ModelPicker.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ThinkingStrengthPicker.tsx
  - src/pages/Chat/thinking-strength-labels.ts
  - src/pages/Chat/session-model.ts
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/dropdown-motion.spec.ts
expectedUserBehavior:
  - The chat model button shows the model and its effective thinking level when available.
  - The grouped model list scrolls independently of the thinking controls at the bottom.
  - Choosing a model keeps the panel open and refreshes the available thinking levels.
  - The existing slider previews during a drag, applies on release and supports restoring the model default.
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
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/dropdown-motion.spec.ts
acceptance:
  - Keyboard and pointer selection can switch a model and adjust its level within one open panel.
  - A pending or failed model selection cannot write a thinking level for a different model.
  - Models without thinking levels keep the list usable and omit the thinking controls when capabilities are known.
  - Existing sessions and unsent drafts use their existing persistence paths.
docs:
  required: true
---

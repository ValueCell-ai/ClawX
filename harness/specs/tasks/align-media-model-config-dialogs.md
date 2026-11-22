---
id: align-media-model-config-dialogs
title: Align speech and image service configuration with chat model service setup
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Reuse the model configuration split layout, keep footer actions anchored, and let existing media service capabilities drive the navigation.
touchedAreas:
  - src/components/settings/**
  - src/assets/providers/**
  - tests/**
  - harness/reference/voice-dictation.md
  - harness/specs/rules/models-configuration-experience.md
  - harness/specs/tasks/align-media-model-config-dialogs.md
  - README*.md
expectedUserBehavior:
  - Choose an existing speech-to-text preset on the left and configure it on the right.
  - Read the API type for each speech service. Custom endpoints use OpenAI Audio Transcriptions.
  - Choose image connection settings or advanced settings on the left, in the same bounded dialog.
  - Keep Cancel and Save anchored while switching services and scrolling the form.
  - Show validation next to the relevant field and keep native save, test, and clear actions.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - models-configuration-experience
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/e2e/models-layout.spec.ts
  - tests/e2e/image-generation-settings.spec.ts
  - tests/e2e/voice-dictation.spec.ts
  - tests/e2e/native-theme-select-popup.spec.ts
  - tests/unit/asr-settings.test.tsx
acceptance:
  - Voice, image, and chat creation share the same split dialog body and action placement.
  - Voice and image summary rows still show persisted settings and regain focus after dismissal.
  - Switching speech presets does not carry the old preset's key into a save.
  - Image generation retains its independent OpenAI Images compatible endpoint and advanced controls.
docs:
  required: true
---

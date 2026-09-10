---
id: add-voice-dictation
title: Add speech-to-text voice dictation to the chat composer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add push-to-talk voice dictation that records microphone audio in the renderer, transcribes it through a user-configured OpenAI-compatible endpoint via a new Main-owned `asr` host module, and inserts the text at the chat composer cursor, with configuration gated behind the Models page Speech-to-text tab.
touchedAreas:
  - harness/specs/tasks/add-voice-dictation.md
  - harness/reference/voice-dictation.md
  - harness/reference/voice-dictation-design.md
  - harness/reference/voice-dictation-plan.md
  - shared/host-api/contract.ts
  - shared/asr/presets.ts
  - shared/asr/errors.ts
  - src/components/ui/select.tsx
  - electron/services/asr/config-store.ts
  - electron/services/asr/asr-client.ts
  - electron/services/asr-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/voice/wav.ts
  - src/lib/voice/recorder.ts
  - src/hooks/useVoiceDictation.ts
  - src/components/voice/VoiceDictationButton.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/components/settings/AsrSettings.tsx
  - src/pages/Models/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - shared/i18n/locales/en/dashboard.json
  - shared/i18n/locales/zh/dashboard.json
  - shared/i18n/locales/ja/dashboard.json
  - shared/i18n/locales/ru/dashboard.json
  - tests/unit/asr-client.test.ts
  - tests/unit/asr-api.test.ts
  - tests/unit/voice-wav.test.ts
  - tests/unit/voice-recorder.test.ts
  - tests/unit/use-voice-dictation.test.tsx
  - tests/unit/voice-dictation-button.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/asr-settings.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-artifact-panel-layout.test.tsx
  - tests/unit/chat-history-reply-while-sending.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-leading-orphan-tools.test.tsx
  - tests/unit/chat-question-directory.test.tsx
  - tests/unit/chat-tool-card-suppression.test.tsx
  - tests/unit/models-page.test.tsx
  - tests/unit/harness-specs.test.ts
  - tests/e2e/voice-dictation.spec.ts
  - electron-builder.yml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - With speech-to-text configured, the chat composer shows a mic button; clicking it starts recording with a visible elapsed timer, clicking again stops recording and inserts the transcribed text at the composer cursor.
  - When speech-to-text is not configured, clicking the mic button shows a localized guidance toast and opens Settings instead of recording.
  - Recording is capped at 180 seconds with automatic stop, Escape cancels and discards a recording, and the composer textarea is not editable while recording or transcribing.
  - Microphone failures, HTTP errors, empty results, and network failures surface localized error toasts without breaking composer state.
  - Models page exposes a developer-gated Speech-to-text tab supporting OpenAI, Groq, SiliconFlow, and custom OpenAI-compatible presets, with the API key stored locally and never synced to OpenClaw.
  - All user-visible voice-dictation and speech-to-text strings are localized in en, zh, ja, and ru.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/asr-client.test.ts tests/unit/asr-api.test.ts tests/unit/voice-wav.test.ts tests/unit/voice-recorder.test.ts tests/unit/use-voice-dictation.test.tsx tests/unit/voice-dictation-button.test.tsx tests/unit/chat-input.test.tsx tests/unit/asr-settings.test.tsx
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/voice-dictation.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/add-voice-dictation.md
acceptance:
  - The `asr` host module exposes `getConfig`, `saveConfig`, and `transcribe` through the existing typed `host:invoke` channel with no new ipcMain channel, and the renderer reaches it only through `hostApi.asr` in `src/lib/host-api.ts`.
  - ASR configuration lives in a dedicated electron-store file and the API key stays in the local provider secret store; neither is written to OpenClaw config or synced to the Gateway.
  - Transcription requests are Main-owned multipart posts to `POST {baseUrl}/audio/transcriptions` with a 30 second timeout, and HTTP statuses map to stable error codes that survive the IPC boundary.
  - Renderer audio capture converts microphone input to 16 kHz mono PCM16 WAV, enforces a 300 ms minimum and a 180 second maximum, and discards cancelled or stale recordings.
  - Transcribed text is inserted at the composer cursor without clobbering surrounding text, and composer editing stays locked during recording and transcription.
  - The mic button and every voice-dictation error or guidance message are localized in en, zh, ja, and ru with no hardcoded display strings.
  - macOS packaging declares `NSMicrophoneUsageDescription` under `mac.extendInfo` in `electron-builder.yml`.
  - Electron E2E coverage proves the record-then-insert flow with mocked `asr` host actions and the unconfigured guidance path, without touching the real microphone or OS-global state.
  - README documentation in en, zh, ja, and ru directs users to Models -> Speech-to-text for configuration and the composer mic button for input.
docs:
  required: true
---

## Scope

`gateway-backend-communication` is the primary scenario because voice dictation
introduces a new Main-owned `asr` module on the existing `host:invoke` channel
and a renderer facade entry, keeping the Renderer/Main and transport authority
boundaries intact.

Design decisions are recorded in `harness/reference/voice-dictation.md`. No new
Gateway transport is introduced: the renderer never fetches the ASR endpoint
directly, and ASR configuration is local-only by design and deliberately
excluded from OpenClaw config delivery.

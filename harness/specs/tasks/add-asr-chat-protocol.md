---
id: add-asr-chat-protocol
title: Add OpenAI Chat Completions (input_audio) speech-to-text protocol with Alibaba Cloud Model Studio preset
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend speech-to-text configuration with an API-type selector so dictation can target either the OpenAI Audio Transcriptions protocol (existing multipart endpoint) or the OpenAI Chat Completions protocol (JSON body with an input_audio content part carrying Base64 WAV and an explicit format, transcript read from choices[0].message.content), with protocol-scoped provider presets adding Alibaba Cloud Model Studio (bailian) for the chat protocol.
touchedAreas:
  - harness/specs/tasks/add-asr-chat-protocol.md
  - harness/reference/voice-dictation.md
  - shared/host-api/contract.ts
  - shared/asr/presets.ts
  - electron/services/asr/asr-client.ts
  - src/components/settings/AsrSettings.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/unit/asr-client.test.ts
  - tests/unit/asr-settings.test.tsx
  - tests/e2e/voice-dictation.spec.ts
expectedUserBehavior:
  - The Speech-to-text settings form shows an API type select offering OpenAI Audio Transcriptions and OpenAI Chat Completions; switching the type resets the provider preset list and prefills the first preset's base URL and model.
  - Under OpenAI Audio Transcriptions, presets are OpenAI, Groq, SiliconFlow, and custom, with the non-editable /audio/transcriptions suffix shown for the standard presets and hidden for custom, whose entered URL is used as the full endpoint; the language select stays visible.
  - Under OpenAI Chat Completions, presets are Alibaba Cloud Model Studio and custom; bailian prefills https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 with model qwen3-asr-flash, no forced suffix is displayed, and the language select is hidden.
  - Chat-protocol transcription posts JSON to {baseUrl}/chat/completions with model, stream false, and a single user message whose input_audio part carries the WAV as a Data URI in data (data:audio/wav;base64,..., bailian dialect, no separate format field); the transcript comes from choices[0].message.content and empty or missing content maps to the EMPTY_RESULT error code.
  - Saved configs record the selected protocol; legacy configs without a protocol keep working as transcriptions.
  - All new user-visible strings are localized in en, zh, ja, and ru.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/asr-client.test.ts tests/unit/asr-api.test.ts tests/unit/asr-settings.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec playwright test tests/e2e/voice-dictation.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/add-asr-chat-protocol.md
acceptance:
  - Protocol branching happens in the Main-process `asr` client only; the renderer keeps using `hostApi.asr.transcribe` with the same WAV payload and never builds protocol-specific requests.
  - `AsrConfig.protocol` is optional in the contract and normalized in Main (`normalizeAsrProtocol`), so stored pre-protocol configs continue to transcribe via the transcriptions endpoint.
  - The chat-protocol request body follows the Alibaba Cloud Model Studio dialect (Data URI `data` with `data:audio/wav;base64,` prelude, no separate `format` field, `stream: false`) without vendor extensions such as `asr_options`.
  - HTTP status to error-code mapping, 30 s timeout, Bearer auth, and empty-result handling stay shared across both protocols.
  - The settings UI scopes the provider preset list by protocol, hides the language select for the chat protocol, and never renders a forced suffix element for chat or custom presets.
  - Unit tests cover the chat request shape, content extraction (string and part array), empty-result mapping, protocol validation, and the settings form's protocol switching and save payload; the Electron E2E spec covers the protocol selector and bailian prefill.
docs:
  required: true
---

## Scope

`gateway-backend-communication` remains the primary scenario because the change
extends the Main-owned `asr` host module's outbound request building while the
renderer boundary (hostApi-only access, no direct external fetch) stays intact.
No Gateway transport, delivery, or fallback path changes, so comms replay is not
required. Design details are recorded in `harness/reference/voice-dictation.md`.

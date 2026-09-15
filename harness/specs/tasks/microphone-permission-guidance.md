---
id: microphone-permission-guidance
title: Guide voice dictation users to microphone privacy settings
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Detect denied microphone permission at voice-input activation and after capture failures, and provide actionable localized system-settings guidance through the Main-owned ASR host API.
touchedAreas:
  - shared/host-api/contract.ts
  - electron/services/asr-api.ts
  - electron/services/asr/microphone-access.ts
  - src/lib/host-api.ts
  - src/hooks/useVoiceDictation.ts
  - src/pages/Chat/ChatInput.tsx
  - src/components/voice/MicrophonePermissionDialog.tsx
  - shared/i18n/locales/**/chat.json
  - tests/unit/**
  - tests/e2e/voice-dictation.spec.ts
  - tests/e2e/fixtures/**
  - harness/specs/tasks/microphone-permission-guidance.md
  - harness/specs/tasks/add-voice-dictation.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/microphone-permission-guidance.md
  - harness/reference/voice-dictation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - entitlements.mac.plist
expectedUserBehavior:
  - Clicking the configured composer microphone checks OS permission without prompting; denied or restricted access shows a dialog instead of attempting recording.
  - First-use permission remains requested by getUserMedia; declining that prompt shows the same actionable guidance after the capture failure.
  - The compact centered dialog shows a title, a short permission explanation, and close/settings actions; detailed platform, restart, and development-launcher instructions are omitted.
  - Closing the dialog leaves the draft editable; a subsequent microphone click reads fresh permission state.
  - Missing hardware and unrelated capture errors keep the existing generic microphone error rather than falsely claiming permission was denied.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - microphone-permission-guidance
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/microphone-access.test.ts tests/unit/asr-api.test.ts tests/unit/use-voice-dictation.test.tsx tests/unit/chat-input.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/voice-dictation.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/microphone-permission-guidance.md
acceptance:
  - The typed asr host actions getMicrophoneAccess and openMicrophoneSettings own OS permission reads and fixed privacy-settings URLs in Main; the renderer uses only hostApi.asr.
  - getMicrophoneAccess is prompt-free on macOS and Windows and returns unknown on unsupported platforms; unknown or not-determined does not prevent normal capture.
  - Denied and restricted permissions have actionable distinct copy in all four locales; opening settings handles failure without claiming success or granting permissions.
  - The permission dialog has bounded width, padding, rounded corners, and viewport-safe scrolling; Electron E2E asserts its rendered layout and concise content.
  - Hook generation cancellation applies across permission queries and failed-capture rechecks, so cancelled or stale starts never show a dialog or start recording.
  - Electron E2E mocks permission reads and settings actions, exercises denied and newly-denied recovery, and never opens real OS settings or requests real microphone access.
  - Existing macOS audio-input entitlements remain intact; permission status does not prove correct signing or working audio hardware.
docs:
  required: true
---

See `harness/reference/voice-dictation.md` for recording and macOS signed-install limitations.
This extends the existing ASR Renderer/Main bridge under `gateway-backend-communication`.

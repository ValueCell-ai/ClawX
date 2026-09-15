---
id: microphone-permission-guidance
title: Microphone permission ownership and recovery
appliesTo:
  - electron/services/asr-api.ts
  - electron/services/asr/microphone-access.ts
  - src/hooks/useVoiceDictation.ts
  - src/components/voice/**
  - src/pages/Chat/ChatInput.tsx
  - tests/e2e/voice-dictation.spec.ts
severity: error
---

- Read microphone permission in Main through the typed ASR host API only when voice input is attempted or capture fails. Status checks must not request grants.
- Keep first-use permission requests on the existing user-triggered getUserMedia path. Denied and restricted access must show actionable, distinct localized feedback, not imply another prompt will appear.
- Main owns fixed macOS and Windows microphone privacy-settings URLs. Open settings only on explicit user action; never reset TCC, change grants, or automatically restart the app.
- Keep the dialog concise: a title, a short denial/restriction explanation, and explicit close/settings actions. Restricted access can require administrator intervention. Detailed platform, restart, and development-launcher instructions belong in documentation, not the dialog.
- DialogContent supplies positioning only. The permission dialog must supply a bounded card width, rounded border, padding, and viewport-safe scrolling; Electron E2E must check actual layout, not only visibility and button behavior.
- Unknown status and unsupported platforms must not prevent capture. A generic microphone failure is not evidence of a denied grant, and granted status is not proof of valid signing or working hardware.
- Preserve hook cancellation and fresh per-attempt permission reads. E2E must mock permission and settings operations instead of changing OS-global state.
- Keep full en/zh/ja/ru coverage and design tokens. See `harness/reference/voice-dictation.md` for signed-package validation.

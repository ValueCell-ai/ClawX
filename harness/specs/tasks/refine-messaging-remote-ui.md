---
id: refine-messaging-remote-ui
title: Refine messaging remote setup and account actions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make messaging app setup and account actions easier to find and use without changing channel routing or stored configuration.
touchedAreas:
  - src/components/channels/ChannelConfigModal.tsx
  - src/components/ui/confirm-dialog.tsx
  - src/pages/Channels/index.tsx
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-supported-catalog.spec.ts
  - tests/e2e/channels-feishu-credential-validation.spec.ts
  - tests/e2e/channels-delete-latency.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/refine-messaging-remote-ui.md
expectedUserBehavior:
  - Setup uses a shared dialog with keyboard dismissal and focus restoration.
  - Messaging apps use the same bounded setup layout, including header, scrolling body and action footer.
  - Feishu shows required credentials up front and WhatsApp shows QR instructions when relevant.
  - Connected apps keep adding accounts and assigning assistants visible, with separate app and account action menus.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - ui-i18n-design-tokens
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - e2e-parallel-isolation
requiredTests:
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-supported-catalog.spec.ts
  - tests/e2e/channels-feishu-credential-validation.spec.ts
  - tests/e2e/channels-delete-latency.spec.ts
acceptance:
  - A user can tab inside setup, dismiss it with Escape, and return to its opener.
  - Feishu, Telegram and WhatsApp use the same dialog width and footer alignment, including after WhatsApp displays its QR code.
  - Missing Feishu credentials are reported at the fields and do not reach host validation.
  - WhatsApp still uses the existing login operation and displays its QR and refresh action.
  - Account edit and deletion operate on the selected account; app deletion retains its separate scope and confirmation.
docs:
  required: true
---

The renderer continues to use the existing channel host API and login events.

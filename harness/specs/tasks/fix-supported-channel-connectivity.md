---
id: fix-supported-channel-connectivity
title: Restore supported channel configuration and plugin activation
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make every ClawX-supported plugin channel persist schema-valid configuration and become visible to the running Gateway after save or QR login.
touchedAreas:
  - harness/specs/tasks/fix-supported-channel-connectivity.md
  - harness/specs/tasks/remove-unsupported-channel-catalog-entries.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - shared/types/channel.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - src/pages/Channels/index.tsx
  - electron/services/channels-api.ts
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/plugin-install-index.ts
  - tests/unit/channels-page.test.tsx
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/e2e/channels-supported-catalog.spec.ts
  - tests/e2e/channels-plugin-save.spec.ts
expectedUserBehavior:
  - Discord, WhatsApp, and QQBot save account credentials under channels.<id> without schema-invalid account mirrors under plugins.entries.<id>.
  - DingTalk, WeCom, Feishu/Lark, WeChat, Discord, WhatsApp, and QQBot trigger a guarded full Gateway restart when saved while the Gateway is running.
  - A no-change retry of a plugin-backed channel still performs the restart needed to discover an already copied plugin.
  - Telegram remains on the native OpenClaw config reload path without an extra ClawX restart.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - channel-plugin-migration-guards
  - openclaw-config-delivery
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/e2e/channels-plugin-save.spec.ts
acceptance:
  - Plugin entries contain activation metadata only and never channel account credentials.
  - Discord, WhatsApp, and QQBot output passes the OpenClaw 2026.7.1 plugin-entry schema shape.
  - External channel plugin ids are retained in plugins.allow even when no unrelated plugin is present.
  - Trusted plugin install metadata targets OpenClaw's active state/openclaw.sqlite database.
  - Plugin-backed saves await the guarded Gateway restart path when the Gateway was running at request start.
  - No Renderer transport or direct Gateway request is added.
docs:
  required: false
---

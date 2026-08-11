---
id: remove-unsupported-channel-catalog-entries
title: Remove unsupported channels from the ClawX channel catalog
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep the ClawX channel configuration UI limited to the eight integrations that ClawX installs and supports.
touchedAreas:
  - harness/specs/tasks/remove-unsupported-channel-catalog-entries.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - shared/types/channel.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - src/pages/Channels/index.tsx
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-supported-catalog.spec.ts
expectedUserBehavior:
  - The Channels page offers only Telegram, Discord, WhatsApp, WeChat, DingTalk, Feishu/Lark, WeCom, and QQBot.
  - Signal, iMessage, Matrix, LINE, Microsoft Teams, Google Chat, and Mattermost are not shown as configurable or configured ClawX channels.
  - Runtime reports for unknown OpenClaw channels do not create editable cards in the ClawX Channels page.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - channel-plugin-migration-guards
  - renderer-main-boundary
  - backend-communication-boundary
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-supported-catalog.spec.ts
acceptance:
  - The shared ChannelType and channel metadata catalog contain exactly the eight ClawX-supported channel ids.
  - Unsupported channel metadata and translations are removed from every supported locale.
  - The Channels page ignores unsupported channel groups returned by the runtime without deleting their OpenClaw configuration.
  - No new direct IPC or Gateway transport is introduced.
docs:
  required: false
---

---
id: upgrade-dingtalk-official-connector
title: Upgrade DingTalk to the official connector on OpenClaw 2026.7.1-2
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace community `@soimy/dingtalk` with official `@dingtalk-real-ai/dingtalk-connector@0.8.25` while keeping the ClawX `dingtalk` channel identity, existing credentials, and a single Stream client.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - electron/utils/plugin-install.ts
  - electron/utils/dingtalk-plugin-compat.ts
  - electron/utils/dingtalk-dws.ts
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - electron/gateway/config-sync.ts
  - electron/services/channels-api.ts
  - shared/host-api/contract.ts
  - shared/types/channel.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - src/pages/Channels/index.tsx
  - src/components/channels/ChannelConfigModal.tsx
  - scripts/after-pack.cjs
  - scripts/bundle-openclaw-plugins.mjs
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/unit/plugin-install.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/dingtalk-plugin-compat.test.ts
  - tests/unit/dingtalk-dws.test.ts
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1-2-plugins.md
  - harness/specs/tasks/upgrade-dingtalk-official-connector.md
expectedUserBehavior:
  - Existing DingTalk users keep `channels.dingtalk` credentials, bindings, and session keys without re-pairing.
  - Channels UI still shows only `dingtalk`; `dingtalk-connector` is never a catalog type.
  - Community soimy and official connector never run at the same time on one `clientId`.
  - Chat works after save even if `dws` workspace authorization is still pending.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/plugin-install.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/dingtalk-plugin-compat.test.ts
acceptance:
  - Official connector is pinned to 0.8.25 and remapped onto plugin/channel id `dingtalk`.
  - npm metadata stays `@dingtalk-real-ai/dingtalk-connector`; Gateway RPC names `dingtalk-connector.*` stay intact.
  - Dual `channels.dingtalk` + `channels.dingtalk-connector` collapses to `dingtalk`.
  - Soimy-only fields are stripped; `messageType: card` maps to `groupReplyMode: aicard`; `defaultAccount` is kept.
  - `plugins.allow` / `plugins.entries` keep a single `dingtalk` identity.
  - Lockfile does not retain `@soimy/dingtalk@3.6.10`.
docs:
  required: true
---

Use this task spec when changing DingTalk plugin ownership, identity remapping, soimy-to-official config sanitization, or dws provisioning.

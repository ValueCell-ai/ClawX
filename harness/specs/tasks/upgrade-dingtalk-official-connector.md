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
  - electron/services/plugin-channel-activation.ts
  - electron/main/index.ts
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
  - tests/unit/channels-page.test.tsx
  - tests/unit/host-services.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/plugin-channel-activation.test.ts
  - tests/e2e/channels-dingtalk-workspace-auth.spec.ts
  - tests/e2e/channels-health-diagnostics.spec.ts
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/tasks/authorize-dingtalk-workspace-after-channel-save.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1-2-plugins.md
  - harness/specs/tasks/upgrade-dingtalk-official-connector.md
expectedUserBehavior:
  - Existing DingTalk users keep `channels.dingtalk` credentials, bindings, and session keys without re-pairing.
  - Channels UI still shows only `dingtalk`; `dingtalk-connector` is never a catalog type.
  - Community soimy and official connector never run at the same time on one `clientId`.
  - Chat works after save even if `dws` workspace authorization is skipped or still pending; new setups can complete optional desktop loopback OAuth from the ClawX channel modal.
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
  - Dual `channels.dingtalk` + `channels.dingtalk-connector` collapses to `dingtalk`; an imported `channels.dingtalk-connector` config with no `plugins` object is migrated before plugin recovery and receives canonical `dingtalk` activation metadata.
  - Soimy-only fields are stripped; `messageType: card` maps to `groupReplyMode: aicard`; nested `groupAllowFrom` maps to `allowFrom`; `defaultAccount` is kept.
  - Existing ClawX configurations preserve the community connector's open-group mention behavior, while configs imported from `dingtalk-connector` preserve the official default.
  - `plugins.allow` / `plugins.entries` keep a single `dingtalk` identity, and startup removes a leftover `extensions/dingtalk-connector` only after the canonical mirror is ready.
  - Lockfile does not retain `@soimy/dingtalk@3.6.10`.
  - New DingTalk setups offer optional dws desktop loopback OAuth after the channel config is durably saved, without exposing the client secret to Renderer.
docs:
  required: true
---

Use this task spec when changing DingTalk plugin ownership, identity remapping, soimy-to-official config sanitization, or dws provisioning.

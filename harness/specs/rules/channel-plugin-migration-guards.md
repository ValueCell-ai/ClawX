---
id: channel-plugin-migration-guards
title: Channel Plugin Migration Guards
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When channel plugin ownership changes between bundled OpenClaw extensions and external `~/.openclaw/extensions/*` installs, ClawX must normalize configuration to one active plugin identity per channel.

The ClawX channel configuration catalog is intentionally limited to `telegram`, `discord`, `whatsapp`, `wechat`, `dingtalk`, `feishu`, `wecom`, and `qqbot`. OpenClaw may report other channel ids, but the ClawX Channels page must not expose them as configurable or editable channel groups. Filtering an unsupported runtime channel is presentation-only and must not delete or rewrite that channel's underlying OpenClaw configuration.

Channel credentials and account maps must remain under `channels.<id>`; `plugins.entries.<id>` is activation metadata and must not contain ClawX-generated `accounts` or `defaultAccount` fields. Discord, WhatsApp, and QQBot are external plugins in the pinned OpenClaw runtime and must retain explicit `plugins.allow` and `{ enabled }` entries. Saving changed configuration for a supported external plugin channel while Gateway is running must use the coordinator-owned `config.set` reload without scheduling a second ClawX full restart when OpenClaw peer link repair succeeds. When peer link repair fails after plugin install, Main must schedule the guarded full restart after the config commit instead of relying on the native reload alone. A no-change retry must still start the guarded full restart path after the scoped-binding commit so a newly copied or previously undiscovered plugin is loaded. Successful WeChat QR completion must likewise leave plugin activation on a single lifecycle path. The host save response may return while activation is still pending, provided it explicitly reports that state and failures are caught and surfaced through normal Gateway status/logging. If `config.set` durably commits before its response is lost to a native code-1012 reload, Main may verify that exact persisted config and treat the transaction as committed; it must not perform an out-of-band replay.

For WeCom specifically, ClawX's canonical account-map representation may contain a single `accounts.default` entry even for a single-account setup. A plugin business tool invoked from a desktop Chat session without `agentAccountId` must use that sole configured account; it must fail closed rather than guess only when two or more configured account IDs make the choice ambiguous. An explicit channel account context always wins.

For Feishu/Lark specifically:

- a configured Feishu channel must not leave both the bundled `feishu` plugin and the legacy external `openclaw-lark` / `feishu-openclaw-plugin` registrations active at the same time
- when the canonical Feishu plugin is external, ClawX must explicitly disable the bundled `feishu` plugin instead of only removing allowlist entries
- when the Feishu channel is not configured, stale Feishu plugin registrations must be removed from `plugins.allow` and `plugins.entries`
- changes to `electron/utils/openclaw-auth.ts`, `electron/utils/channel-config.ts`, or `electron/gateway/config-sync.ts` that affect channel/plugin migration must keep direct regression coverage for the dual-plugin migration state

For DingTalk specifically:

- ClawX's catalog identity remains `dingtalk`. Do not expose `dingtalk-connector` as a Channels-page type
- only one DingTalk plugin identity may be active: remapped official `@dingtalk-real-ai/dingtalk-connector` under `dingtalk`. Never leave community `@soimy/dingtalk` and the official connector both enabled
- `channels.dingtalk` is the source of truth. If `channels.dingtalk-connector` also exists, collapse it onto `dingtalk` and delete the official key so two Stream clients cannot share one `clientId`
- leftover `~/.openclaw/extensions/dingtalk-connector` must be removed after the official package is mirrored to `~/.openclaw/extensions/dingtalk`
- soimy-only config fields must be sanitized before write; `defaultAccount` is allowed on the official 0.8.25 schema

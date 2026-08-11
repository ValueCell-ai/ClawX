---
id: channel-plugin-migration-guards
title: Channel Plugin Migration Guards
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When channel plugin ownership changes between bundled OpenClaw extensions and external `~/.openclaw/extensions/*` installs, ClawX must normalize configuration to one active plugin identity per channel.

The ClawX channel configuration catalog is intentionally limited to `telegram`, `discord`, `whatsapp`, `wechat`, `dingtalk`, `feishu`, `wecom`, and `qqbot`. OpenClaw may report other channel ids, but the ClawX Channels page must not expose them as configurable or editable channel groups. Filtering an unsupported runtime channel is presentation-only and must not delete or rewrite that channel's underlying OpenClaw configuration.

Channel credentials and account maps must remain under `channels.<id>`; `plugins.entries.<id>` is activation metadata and must not contain ClawX-generated `accounts` or `defaultAccount` fields. Discord, WhatsApp, and QQBot are external plugins in the pinned OpenClaw runtime and must retain explicit `plugins.allow` and `{ enabled }` entries. Saving any supported external plugin channel while Gateway is running must start the guarded full restart path after the coordinated config and scoped-binding commits, including no-change retries and successful WeChat QR completion, so a newly copied or previously undiscovered plugin is loaded. The host save response may return while that restart is still pending, provided it explicitly reports the pending activation state and restart failures are caught and surfaced through normal Gateway status/logging.

For Feishu/Lark specifically:

- a configured Feishu channel must not leave both the bundled `feishu` plugin and the legacy external `openclaw-lark` / `feishu-openclaw-plugin` registrations active at the same time
- when the canonical Feishu plugin is external, ClawX must explicitly disable the bundled `feishu` plugin instead of only removing allowlist entries
- when the Feishu channel is not configured, stale Feishu plugin registrations must be removed from `plugins.allow` and `plugins.entries`
- changes to `electron/utils/openclaw-auth.ts`, `electron/utils/channel-config.ts`, or `electron/gateway/config-sync.ts` that affect channel/plugin migration must keep direct regression coverage for the dual-plugin migration state

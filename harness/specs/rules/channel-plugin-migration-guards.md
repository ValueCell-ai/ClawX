---
id: channel-plugin-migration-guards
title: Channel Plugin Migration Guards
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When channel plugin ownership changes between bundled OpenClaw extensions and external `~/.openclaw/extensions/*` installs, ClawX must normalize configuration to one active plugin identity per channel.

For Feishu/Lark specifically:

- a configured Feishu channel must not leave both the bundled `feishu` plugin and the legacy external `openclaw-lark` / `feishu-openclaw-plugin` registrations active at the same time
- when the canonical Feishu plugin is external, ClawX must explicitly disable the bundled `feishu` plugin instead of only removing allowlist entries
- when the Feishu channel is not configured, stale Feishu plugin registrations must be removed from `plugins.allow` and `plugins.entries`
- changes to `electron/utils/openclaw-auth.ts`, `electron/utils/channel-config.ts`, or `electron/gateway/config-sync.ts` that affect channel/plugin migration must keep direct regression coverage for the dual-plugin migration state

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

- the Feishu plugin id must follow the installed mirror manifest after prelaunch plugin maintenance. Sanitize runs before the mirror upgrade, so an in-place upgrade must re-point `openclaw-lark` activation at `feishu` once the official mirror is installed, and must leave it untouched if the upgrade fails
- the official `feishu` channel schema forbids unknown keys, so one leftover openclaw-lark setting invalidates the whole `openclaw.json`, and Doctor does not remove them. When activation moves off a legacy id, ClawX must prune `channels.feishu` and its accounts against the installed manifest's `channelConfigs.feishu.schema` (never a hardcoded key list), map boolean `streaming` like Doctor, and leave the aliases that the official Doctor contract migrates (`streamMode`, `chunkMode`, `blockStreaming`, `blockStreamingCoalesce`, `webhookHost`, `webhookPort`, `tools.base`). A legacy entry's `config` must not carry over into `plugins.entries.feishu`

Plugin mirror upgrades must never leave a partial mirror in `~/.openclaw/extensions/`. Copy into a staging directory outside plugin discovery and swap it in with `replacePluginMirror` only once it holds a manifest, keeping the previous mirror if the copy or swap fails. Otherwise a retry would see a matching `package.json` and skip a broken install.

For OpenClaw capability consent:

- ClawX records consent only for its own path-owned mirrors, and only for ids that are already explicitly enabled and allowed; consent must never enable a plugin
- consent must go through OpenClaw (`openclaw plugins enable <ids...> --accept-capabilities`) offline before Gateway start. ClawX must not compute or write `acceptedSurface*` fields itself, because the hash covers OpenClaw's normalized manifest metadata
- the consent CLI must be cached per install-record fingerprint and attempted once per fingerprint, so its per-plugin cost (about 9s) is paid only after an install, upgrade, or runtime change

For plugin loading on Windows:

- OpenClaw plugin captures link directories with junctions, which store absolute targets. Any copy of a capture tree must recreate directory links as junctions and relocate in-tree targets; `fs.cpSync` with `verbatimSymlinks` creates untyped symlinks that standard Windows users cannot create (`EPERM`). Keep `tests/unit/openclaw-windows-recovery-junction-patch.test.ts` covering the ClawX OpenClaw patch for this
- macOS cannot reproduce Windows link failures natively. Validate changes to capture linking with a preload that stores junction targets as absolute paths and rejects untyped capture symlinks with `EPERM`

For QQ Bot specifically:

- OpenClaw 2026.10.5 serves the `qqbot` channel from Tencent QQBot 2.0 under plugin id `openclaw-qqbot`. Only `openclaw-qqbot` may be active in `plugins.allow` / `plugins.entries`, and legacy `qqbot` activation must migrate with its entry settings
- `channels.qqbot` must be written in the Tencent 2.0 shape: the root is the `default` account, `accounts` holds only named accounts, and there is no `defaultAccount`. The root and every account need a non-wildcard `allowFrom`; open DMs use `openclaw:approval-disabled` with `dmPolicy: "open"`, matching OpenClaw Doctor
- approval, `clientSecretFile`, legacy streaming transport, group command policy, and `commands.allowFrom` shapes belong to OpenClaw Doctor and must not be rewritten by ClawX
- every ClawX account mutation must lift the Tencent shape back into ClawX's account model before it changes accounts, and must run the write sanitizer before committing

For DingTalk specifically:

- ClawX's catalog identity remains `dingtalk`. Do not expose `dingtalk-connector` as a Channels-page type
- only one DingTalk plugin identity may be active: remapped official `@dingtalk-real-ai/dingtalk-connector` under `dingtalk`. Never leave community `@soimy/dingtalk` and the official connector both enabled
- `channels.dingtalk` is the source of truth. If `channels.dingtalk-connector` also exists, collapse it onto `dingtalk` and delete the official key so two Stream clients cannot share one `clientId`
- leftover `~/.openclaw/extensions/dingtalk-connector` must be removed after the official package is mirrored to `~/.openclaw/extensions/dingtalk`
- prelaunch must provision or repair the bundled dws CLI whenever DingTalk is already configured, including old-install upgrades that do not pass through channel save; this repair must not be hidden behind plugin-maintenance cache hits or block basic chat when dws is unavailable
- soimy-only config fields must be sanitized before write; preserve compatible settings by mapping nested `groupAllowFrom` to `allowFrom` and retaining the legacy open-group mention default; `defaultAccount` is allowed on the official 0.8.25 schema

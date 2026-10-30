---
id: harden-feishu-official-plugin-migration
title: Keep the Gateway startable when Feishu moves from openclaw-lark to the official plugin
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: An in-place upgrade from openclaw-lark to the official `@openclaw/feishu` plugin could leave `openclaw.json` invalid (openclaw-lark-only channel keys or entry config) or leave a half-copied plugin mirror, and either one keeps the whole Gateway down. Migrate the Feishu config against the installed schema and make plugin mirror replacement atomic.
touchedAreas:
  - electron/utils/openclaw-auth.ts
  - electron/utils/plugin-install.ts
  - electron/gateway/config-sync.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/tasks/harden-feishu-official-plugin-migration.md
expectedUserBehavior:
  - A Feishu setup that used openclaw-lark-only settings (such as `footer`, `threadSession`, `uat`, or `replyMode`) starts on the official plugin after an in-place upgrade instead of failing config validation and taking the Gateway down.
  - Boolean `streaming` keeps its intent as `streaming.mode` (`partial` or `off`), and the legacy aliases that OpenClaw Doctor migrates are left for Doctor.
  - Feishu settings the official schema accepts, credentials, and account maps are unchanged.
  - If a plugin mirror copy or swap fails (for example a Windows file lock), the previous mirror stays installed and the next launch retries the upgrade.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - When Feishu activation moves from a legacy id onto the installed official plugin, `channels.feishu` and every account are pruned against the installed manifest's `channelConfigs.feishu.schema`, including nested objects that forbid unknown keys, with every removed path logged.
  - Pruning never runs when activation is already on the official plugin, when the old mirror is still installed, or for keys the official Doctor contract migrates (`streamMode`, `chunkMode`, `blockStreaming`, `blockStreamingCoalesce`, `webhookHost`, `webhookPort`, `tools.base`).
  - A legacy plugin entry's `config` is not merged into `plugins.entries.feishu`.
  - Every channel plugin install and upgrade path uses `replacePluginMirror`, which stages the copy outside `extensions/`, swaps it in only when it has a manifest, restores the previous mirror when the swap fails, and removes the staging directory.
  - A synthetic OpenClaw 2026.10.5 home seeded with openclaw-lark-only Feishu keys and the compacted official mirror passes `openclaw config validate` with no warnings after the prelaunch Feishu sync.
docs:
  required: true
---

OpenClaw Doctor's Feishu contract only migrates known aliases, so it cannot
repair keys that only openclaw-lark read, and ClawX startup recovery runs
Doctor once before failing. See the Feishu entries in
`harness/reference/openclaw-2026-10-5-upgrade.md` for the synthetic Doctor
run and validation evidence.

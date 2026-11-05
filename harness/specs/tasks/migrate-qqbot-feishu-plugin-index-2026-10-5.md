---
id: migrate-qqbot-feishu-plugin-index-2026-10-5
title: Migrate QQ Bot, Feishu, and plugin install records for in-place 0.6.1 → OpenClaw 2026.10.5 upgrades
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep every ClawX-managed channel plugin working after an in-place upgrade from ClawX 0.6.1 (OpenClaw 2026.7.1-2) without OpenClaw Doctor. Move QQ Bot onto the Tencent QQBot 2.0 provider and config shape, re-point Feishu activation once the official mirror is installed, and write install records to the 2026.10 `config_machine_state` index.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - electron/utils/qqbot-plugin-compat.ts
  - electron/utils/plugin-install-index.ts
  - electron/utils/plugin-install.ts
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - electron/gateway/config-sync.ts
  - scripts/bundle-openclaw-plugins.mjs
  - scripts/after-pack.cjs
  - tests/unit/qqbot-plugin-compat.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/tasks/upgrade-openclaw-2026-10-5.md
  - harness/specs/tasks/migrate-qqbot-feishu-plugin-index-2026-10-5.md
expectedUserBehavior:
  - A ClawX 0.6.1 QQ Bot setup starts on OpenClaw 2026.10.5 without Doctor. The `default` account and named agent accounts keep their credentials and bindings, open DMs stay open, and explicit allowlists keep their IDs.
  - QQ Bot runs on Tencent QQBot 2.0 (`openclaw-qqbot`) from the bundled mirror, including its `@tencent-connect/qqbot-connector` dependency. OpenClaw does not reinstall it from npm.
  - Saving, deleting, or rebinding QQ Bot accounts in ClawX keeps `channels.qqbot` valid for the Tencent 2.0 schema. Choosing a named default while a `default` account exists is rejected with an explanation instead of being silently reverted.
  - A 0.6.1 Feishu setup on `openclaw-lark` is active under the official `feishu` plugin on the first upgraded launch, with its entry settings preserved. If the mirror upgrade fails, the previous plugin stays active.
  - The Feishu tool reduction (39 openclaw-lark tools → 14 official tools, without calendar, task, user OAuth, sheet, or search) is accepted and documented in the upgrade notes.
  - Plugin install records written by ClawX are visible to OpenClaw 2026.10.5 on both freshly migrated and already-migrated state databases, and ClawX never recreates the retired index table.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/qqbot-plugin-compat.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/config-sync.test.ts
acceptance:
  - '`@tencent-connect/openclaw-qqbot` is pinned to 2.0.3 with `@tencent-connect/qqbot-connector` 1.2.0, and `@openclaw/qqbot` is no longer in the lockfile.'
  - Both plugin bundlers ship peer dependencies that are also runtime dependencies, and still skip host-provided peers such as `openclaw`.
  - Prelaunch sanitize migrates `qqbot` activation to `openclaw-qqbot` and the ClawX account shape to the Tencent 2.0 shape. It leaves approval, secret-file, streaming-transport, group-command, and `commands.allowFrom` policies for Doctor.
  - The QQ Bot install record is a path record under `openclaw-qqbot`, and the legacy `qqbot` record is removed.
  - Feishu activation is re-pointed at the installed manifest id after plugin maintenance, so first-launch sanitize ordering cannot leave Feishu disabled.
  - Install-index writes target `plugins.installedIndex` on migrated databases. They are transactional, back off while the plugin lifecycle lease is held, skip invalid rows, bump the revision, drop stale projections, preserve capability consent, and drop a stray legacy table. Fresh databases keep the legacy table that OpenClaw imports.
  - A synthetic OpenClaw 2026.10.5 home seeded with a 0.6.1 config reaches Gateway `ready` with `openclaw-qqbot` loaded and `config validate` returning valid.
docs:
  required: true
---

ClawX 0.6.1 users upgrade in place, so the first 2026.10.5 launch sees a
2026.7.1 config, a `@openclaw/qqbot` mirror, an `openclaw-lark` Feishu mirror,
and install records in the retired index format. The fixes stay in ClawX's
prelaunch path, mirroring OpenClaw Doctor's own
`qqbot.tencent-2.0-compatibility` rule for the shapes ClawX writes, and leave
user-authored policy shapes to Doctor. See
`harness/reference/openclaw-2026-10-5-upgrade.md` for the index format,
migration details, and synthetic Gateway evidence.

---
id: guard-feishu-dual-plugin-migration
title: Guard Feishu dual-plugin migration during gateway config sanitization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve the single-plugin Feishu migration contract across upgrades and config rewrites.
touchedAreas:
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - electron/gateway/config-sync.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/harness-specs.test.ts
  - harness/src/cli.mjs
  - harness/src/rules.mjs
  - harness/src/specs.mjs
  - harness/specs/tasks/guard-feishu-dual-plugin-migration.md
  - harness/specs/tasks/guard-plugin-resolution.md
  - harness/specs/tasks/plugin-validation.md
  - harness/specs/tasks/plugin-recovery-and-rollback.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/rules/capability-owner-resolution.md
  - harness/specs/rules/active-config-guards.md
expectedUserBehavior:
  - Migrated Feishu/Lark users do not end up with duplicate message handling because only one Feishu plugin remains active.
  - Saving Feishu channel settings rewrites stale plugin registration state to a single canonical external plugin and disables the bundled plugin when required.
  - Removing Feishu channel configuration clears stale Feishu plugin registrations from the OpenClaw config.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - `sanitizeOpenClawConfig()` keeps at most one active Feishu plugin identity in `plugins.allow` / `plugins.entries`.
  - Bundled `feishu` is explicitly disabled when the canonical Feishu plugin is external.
  - Residual Feishu plugin registrations are removed when the Feishu channel is not configured.
docs:
  required: false
---

Use this task spec when changing Feishu/Lark plugin migration, channel config normalization, or gateway prelaunch config sanitization.

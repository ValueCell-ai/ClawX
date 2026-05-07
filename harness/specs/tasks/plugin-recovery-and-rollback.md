---
id: plugin-recovery-and-rollback
title: Recover from plugin upgrade, migration, and activation failures
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Keep ClawX recoverable when plugin upgrades, migrations, or activation changes fail.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - electron/utils/plugin-install.ts
  - electron/gateway/skills-symlink-cleanup.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/plugin-install.test.ts
  - harness/specs/tasks/plugin-recovery-and-rollback.md
  - harness/specs/rules/capability-owner-resolution.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
expectedUserBehavior:
  - Failed plugin upgrades do not leave duplicate or stale active capability owners.
  - Removed or unconfigured capabilities have residual plugin registrations cleaned up.
  - Recovery preserves user-owned config where possible and leaves clear diagnostics when manual action is needed.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - Recovery paths converge to a single diagnosable runtime state.
  - Stale plugin directories, entries, allowlist values, and install metadata are handled according to source type.
  - Rollback or cleanup behavior has direct regression coverage for the affected plugin class.
docs:
  required: false
---

Use this task spec when changing plugin cleanup, rollback, stale install handling, or failure recovery paths.

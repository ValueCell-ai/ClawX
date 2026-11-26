---
id: fix-cross-volume-plugin-staging
title: Install channel plugins through a redirected extensions directory
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Allow ClawX to install and upgrade bundled channel plugins when the Windows extensions directory is a junction to another volume.
touchedAreas:
  - electron/utils/plugin-install.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - tests/unit/plugin-install.test.ts
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/tasks/fix-cross-volume-plugin-staging.md
expectedUserBehavior:
  - Saving a WeCom channel configuration can install its bundled plugin when extensions is redirected to another drive.
  - An existing channel plugin can be upgraded in the same directory layout and recovered if publication fails.
requiredProfiles:
  - fast
requiredRules:
  - channel-plugin-migration-guards
requiredTests:
  - tests/unit/plugin-mirror-replace.test.ts
  - tests/unit/plugin-install.test.ts
acceptance:
  - Stage the mirror outside plugin discovery on the volume containing the resolved extensions directory so the final rename can succeed.
  - Fresh installation creates a missing extensions directory and publishes a complete mirror.
  - A redirected-directory regression exercises the staging location and preserves the previous mirror through rollback.
  - A working same-volume staging junction remains usable after an in-place upgrade.
references:
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
docs:
  required: false
---

Windows returned `EXDEV` while renaming a prepared WeCom plugin from
`.openclaw/.clawx-plugin-staging` into `.openclaw/extensions/wecom`. Both
directories were writable. Redirecting the staging directory to the extensions
volume allowed the user to connect WeCom. ClawX should perform the same-volume
publication through its normal channel configuration flow.

For Windows enterprise installer validation, use separate disposable profiles
for the 0.6.1-biz.1 and 0.7.1-biz.1 baselines. Record the installed versions,
preservation of existing channel configuration and the result of saving a
channel after the upgrade.

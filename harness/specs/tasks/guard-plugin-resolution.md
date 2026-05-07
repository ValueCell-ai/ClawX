---
id: guard-plugin-resolution
title: Guard plugin package and capability owner resolution
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Change plugin discovery, migration, or owner selection without introducing duplicate active capability owners.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - electron/utils/plugin-install.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/plugin-install.test.ts
  - harness/specs/tasks/guard-plugin-resolution.md
  - harness/specs/rules/capability-owner-resolution.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
expectedUserBehavior:
  - Plugin upgrades and migrations keep configured capabilities owned by one active package.
  - Existing channel/provider/skill business config survives ownership migration.
  - Stale plugin registrations do not reactivate old owners after restart.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - Single-owner capabilities have at most one active owner in final runtime config.
  - Bundled and external ownership conflicts have direct regression coverage.
  - Discovery, resolution, and activation responsibilities remain separate in the changed code.
docs:
  required: false
---

Use this task spec when changing plugin discovery, canonical owner selection, plugin ID migration, channel/provider plugin registration, or startup config sanitization.

---
id: plugin-validation
title: Validate plugin packages and capabilities before activation
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Ensure plugin packages and capabilities are validated before they become active runtime configuration.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - electron/utils/plugin-install.ts
  - electron/api/routes/skills.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/plugin-install.test.ts
  - harness/specs/tasks/plugin-validation.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
expectedUserBehavior:
  - Invalid plugin packages do not become active silently.
  - Capability config errors are surfaced as blocked, conflicted, degraded, or actionable diagnostics.
  - Valid plugin changes keep Gateway startup and configured capabilities usable.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
acceptance:
  - Package manifest, dependency, and compatibility checks run before activation when affected by the task.
  - Capability validation checks owner uniqueness and required config.
  - Failure states are diagnosable and do not leave stale active owners.
docs:
  required: false
---

Use this task spec when changing plugin validation, manifest checks, dependency readiness, or capability readiness gates.

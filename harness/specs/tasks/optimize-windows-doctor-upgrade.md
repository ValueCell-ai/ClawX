---
id: optimize-windows-doctor-upgrade
title: Profile and reduce Windows upgrade Doctor latency
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Measure the approximately eighty-second packaged Doctor repair on both preserved Windows upgrade baselines, remove demonstrated redundant work without weakening migration safeguards, and compare isolated packaged upgrade outcomes.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-snapshot-admission-cleanup.test.ts
  - tests/unit/openclaw-missing-journal-producer.test.ts
  - harness/specs/tasks/validate-windows-sqlite-upgrade.md
  - harness/specs/tasks/optimize-windows-doctor-upgrade.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/openclaw-2026-10-10-upgrade.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
  - harness/reference/windows-doctor-performance-20261109.md
expectedUserBehavior:
  - Upgrades preserve the previously verified databases, history, credentials, workspace and channel connections while reaching readiness sooner where measured redundant work can be removed.
  - Migration safety checks, offline ownership, private staging, backups and error propagation remain effective.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/openclaw-snapshot-admission-cleanup.test.ts
  - tests/unit/openclaw-missing-journal-producer.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - Attribute Doctor wall time using phase traces and targeted runtime measurements; distinguish active work, process launch overhead and waiting from pure SQLite schema migration.
  - Start each compared upgrade from the same verified old snapshot. Restore only while the isolated runtime and its port are stopped, and await successful restore completion before launching.
  - Launch only the validated isolated Electron launcher with isolated HOME, userData, state, temporary paths and ports. Never launch the normal installed ClawX or a packaged executable without that launcher.
  - Implement only a measured optimization and retain required ACL, file identity, reader lifetime, backup, integrity, ownership and recovery validations.
  - Test both affected and failure paths for any changed resource or security-sensitive behavior.
  - Revalidate both official 0.6.1 and main upgrade paths, histories, new local-model replies, credentials, workspace, four permitted channel connections, offline integrity and repeated startup.
  - Report raw and summarized timing observations, sample sizes, instrumentation overhead and test-environment limitations. Do not imply a production performance guarantee.
docs:
  required: true
references:
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
  - harness/reference/windows-doctor-performance-20261109.md
---

This continues the verified Windows migration fixes. The prior final Doctor
repair took about 82 seconds for main and 80 seconds for official 0.6.1. The
user explicitly requires all additional validation to remain isolated from
the installed ClawX. Preserve previous passing packages and evidence.

---
id: validate-windows-sqlite-upgrade
title: Validate Windows SQLite upgrades from ClawX 0.6.1 and main
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Investigate the reported Windows SQLite snapshot cleanup failure and exercise official ClawX 0.6.1 and main as separate native Windows package upgrade inputs with retained history, credentials and configured channels.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-snapshot-admission-cleanup.test.ts
  - tests/unit/openclaw-missing-journal-producer.test.ts
  - harness/specs/tasks/validate-windows-sqlite-upgrade.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/openclaw-2026-10-10-upgrade.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
expectedUserBehavior:
  - Windows upgrades from official ClawX 0.6.1 and main independently reach a ready Gateway while preserving credentials and session history.
  - Temporary SQLite snapshots are retired only after their native readers release the files, including repeated startup and Doctor migration reads.
  - Configured channel accounts retain their settings and load compatible plugins after each upgrade, with connection results recorded independently from message delivery.
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
  - Identify each old package and target by source revision, OpenClaw and Electron versions, and checksum where available; exercise both upgrade routes independently.
  - Isolate application data, OpenClaw state, workspaces, temporary directories and ports from the live user profile, and create retained conversations with the old application before upgrading.
  - Record migration and repeated startup readiness, schema versions, offline integrity checks, retained history and provider credentials for each route.
  - Verify retained channel configuration, plugin loading and available connection results for each route. Explicitly report external authentication failures and untested message delivery.
  - Replay the field SQLite snapshot and schema inspection path on isolated copies using the relevant Windows runtimes. Distinguish observed EPERM diagnostics from a reproduced cause, and do not patch cleanup without evidence.
  - Release host identity descriptors for retained private snapshots after readers drain and before the native cleanup worker unlinks files; cover descriptor closure, active-reader protection and cleanup failures with a targeted regression.
  - Close temporary transcript import stage admissions before removing their directories, including callback failures, so successful imports are not reported as transcript mismatches by Windows ENOTEMPTY cleanup errors.
  - Recognize the verified native-first stable OpenClaw 2026.10.5 schema 25 producer for missing-journal recovery while preserving exact ownership, unchanged producer timestamps, missing-journal receipts, absent deletion records, current authority and verified backup requirements. Reject other versions, schemas and changed metadata.
  - Preserve genuine cleanup errors and source data. Report installer replacement, operating-system registration and live service coverage according to what the recorded execution actually exercises.
docs:
  required: true
references:
  - harness/reference/openclaw-2026-10-10-upgrade.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
---

The 2026-11-09 field report records an Agent admission failure followed by
Doctor cleanup failures when Windows cannot unlink a nested temporary
`database.sqlite`. Native lifetime and file attributes must be verified before
selecting a fix. Run native Windows package validation with isolated profiles.

The focused auth ownership, startup classification and recovery suites passed
on Windows with 73 tests across three files. Package-level results and field
reproduction limits belong in the linked validation reference.

The full Doctor reproduction and native open/close trace identify a retained host
file descriptor from SQLite admission, while the worker native connection has
already closed. The minimal regression must retain that identity descriptor and
verify its closure before delegated snapshot cleanup. Both original and corrected
packages remain separate validation artifacts.

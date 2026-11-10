---
id: fix-offline-restore-json5-port
title: Refuse offline restore when the current JSON5 Gateway port is active or unknown
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix the recovery CLI silently dropping the current Gateway port when openclaw.json uses JSON5, which could permit restoring state owned by a running Gateway on a changed port.
touchedAreas:
  - .gitattributes
  - resources/cli/restore-openclaw-upgrade.mjs
  - tests/unit/openclaw-restore-offline.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/fix-offline-restore-json5-port.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/openclaw-2026-10-10-upgrade.md
expectedUserBehavior:
  - Recovery checks the current JSON5 Gateway port as well as the original and default ports before changing state.
  - Unreadable or invalid current configuration blocks recovery with an actionable error.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/openclaw-restore-offline.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
acceptance:
  - Supported JSON5 syntax preserves the current port when it differs from the snapshot port.
  - A listening current port or an unknown current port prevents any recovery staging or publication.
  - Parse and validate the current configuration again immediately before publication.
  - Cover dependency resolution from the installed resources/cli and sibling resources/openclaw layout with a real Node subprocess.
  - Keep every fixture and listener isolated from the installed ClawX application and its profile.
docs:
  required: true
references:
  - harness/reference/openclaw-2026-10-10-upgrade.md
---

The original offline check catches every JSON.parse/read error and keeps only
the default and snapshot ports. Both checks therefore miss a live Gateway whose
new port is stored in a supported JSON5 configuration. Recovery is a manual path;
this does not establish a failure in ordinary startup migration.

Validation on Windows: the original helper completed a restore despite the
changed JSON5 port's live test listener; the fixed helper refuses before staging.
All 19 new subprocess regressions and 17 existing snapshot tests pass. The tests
use temporary resource/profile directories and a random loopback listener;
default/old port probes are simulated so the installed ClawX is never contacted.
Targeted ESLint and the CLI syntax check pass. Task validation against HEAD and
the task dry-run pass; harness CI passes its 22 baseline tests, and communication
replay/compare pass. Existing Windows harness CRLF and comms URL-path workarounds
were temporary and restored after validation. No installer rebuild or live-app
operation is part of this review fix.

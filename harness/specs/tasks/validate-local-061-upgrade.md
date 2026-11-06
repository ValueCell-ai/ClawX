---
id: validate-local-061-upgrade
title: Validate a local Windows upgrade from the official ClawX 0.6.1 release
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Exercise old-release state creation, current-runtime migration, restart and persistence in isolated local profiles using matching dependencies, and distinguish runtime failures from test environment limitations.
touchedAreas:
  - electron/gateway/**
  - electron/utils/openclaw-auth.ts
  - tsconfig.node.json
  - tests/unit/gateway-*.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/**
  - harness/specs/tasks/validate-local-061-upgrade.md
  - harness/specs/tasks/fix-upgrade-state-ownership-recovery.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/reference/local-061-upgrade-validation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Existing settings, credentials, agents, conversations and workspace files survive upgrade.
  - A migrated Gateway becomes ready and remains usable across restart and concurrent session activity.
  - State ownership contention and interrupted startup retain actionable diagnostics without an ineffective Doctor loop.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - openclaw-upgrade-persistence
  - gateway-readiness-policy
  - channel-plugin-migration-guards
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
acceptance:
  - Verify the old installer checksum and actual old/new OpenClaw and Electron versions before claiming an upgrade result.
  - Test profiles isolate HOME, USERPROFILE, APPDATA, LOCALAPPDATA, OpenClaw state/config, workspace and Gateway port; do not migrate the real user profile.
  - Record startup phase timings, final readiness, integrity and retained synthetic data across the real runtime migration where available.
  - Report failed, skipped and untested cases, including installer registration or external-service coverage, without equating unit tests with a successful installed upgrade.
  - Retain logs and reproducible scripts in the independent validation directory and document actionable findings.
docs:
  required: true
references:
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/reference/local-061-upgrade-validation.md
---

Local evidence and runners are kept under
`D:/ClawX-upgrade-validation-20261104`. The official 0.6.1 NSIS package is
extracted for execution rather than installed over the user's active ClawX.
The current branch also contains the uncommitted state-ownership recovery fix
described by `fix-upgrade-state-ownership-recovery`; tests must identify this
working-tree build rather than presenting it as a published release.

## Validation results

- Official old-package to packaged working-tree migration, two subsequent starts,
  and two concurrent tool-using sessions passed in the isolated profile.
- Focused upgrade tests: 289 passed. Functional Electron E2E: 199 passed,
  3 skipped. TypeScript passed; ESLint reported zero errors and seven warnings.
- Full unit suite: 2,897 passed, 70 failed, 6 skipped, plus three suite import
  failures. This is not a full release acceptance pass.
- Actual communication replay/comparison passed using a temporary Windows
  file-URL workaround. Task validation against HEAD, dry-run, and harness CI
  passed (22 baseline tests) using temporary LF frontmatter normalization.
  Original tool/spec bytes were restored after each workaround.
- Startup timings, retained data, remaining failures, reproducible scripts and
  coverage limits are recorded in `harness/reference/local-061-upgrade-validation.md`.

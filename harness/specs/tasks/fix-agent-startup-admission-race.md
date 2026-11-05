---
id: fix-agent-startup-admission-race
title: Guard model changes during agent startup admission
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent model-switch startup races and recover a superseded model publication without changing OpenClaw or upgrade persistence.
touchedAreas:
  - electron/gateway/agent-database-admission.ts
  - electron/gateway/manager.ts
  - electron/services/agents-api.ts
  - tests/unit/gateway-agent-database-admission.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-model-picker.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/fix-agent-startup-admission-race.md
expectedUserBehavior:
  - Model changes are refused before config or credential writes while Gateway startup admission is incomplete.
  - A failed admission is not shown as ready, and a superseded model publication may recover once on a ClawX-owned Gateway.
  - Slow upgrade preparation is never interrupted by this recovery; older Gateway compatibility and offline model configuration are preserved.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/gateway-agent-database-admission.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Pending and failed admission never become ready merely because a timeout elapses.
  - Missing admission fields on valid older readiness responses remain compatible; unrelated channel failures do not block Agent readiness.
  - Probe failures retry and cannot override an observed admission block.
  - Only explicit superseded publication failures trigger at most one automatic owned-process restart per recovery chain.
  - External Gateways and agents still preparing are never restarted by admission recovery.
  - Recovery callbacks are connection scoped and cancelled on stop or restart.
  - Upgrade backups, migrations, Doctor and OpenClaw package contents are unchanged.
  - Comms replay and compare pass.
docs:
  required: true
---

Regression source: Windows ClawX 0.7.0-biz.0 / OpenClaw 2026.10.5 issue report
`clawx-issue-report-20261103-075735Z`. Model selection overlapped background
admission, which failed with `prepared model runtime publication was superseded`.
The old pending-only probe then incorrectly published gatewayReady.

Validation must distinguish synthetic lifecycle coverage from a real Windows
upgrade or enterprise login reproduction; do not claim the latter from mocks.

## Validation results

- Focused Gateway, host-service and upgrade-snapshot regressions: 21 files,
  284 tests passed with `--maxWorkers=2`. The first higher-concurrency run hit
  the existing gateway-events hydration test's one-second wait; that test
  passed alone and the complete selection passed with two workers.
- Harness CI baseline: 22 tests passed; task validation and dry-run passed
  with `--since HEAD` to scope this work instead of the branch's prior changes.
- TypeScript node/web checks, changed-file ESLint, `git diff --check`, and
  `pnpm run build:vite` passed.
- Communication replay and comparison passed.
- macOS Electron model-picker and Gateway lifecycle E2E: 6 tests passed.
  Model-picker refusal is a simulated host response; the Main write guard and
  recovery state machine are covered separately by unit tests.
- No live Windows upgrade, enterprise logout/login reproduction, or packaged
  installer verification was performed. OpenClaw/Biz and user data are unchanged.

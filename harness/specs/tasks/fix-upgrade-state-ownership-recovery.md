---
id: fix-upgrade-state-ownership-recovery
title: Stop invalid Doctor recovery after Gateway ownership contention or cancellation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: An upgraded Windows Gateway waited five minutes for state ownership, exited 1, and was incorrectly sent through Doctor and another startup. Stopping that retry also triggered Doctor. Recognize ownership contention before the generic exit-code fallback and fence startup recovery against stop or a newer lifecycle.
touchedAreas:
  - electron/gateway/startup-recovery.ts
  - electron/gateway/startup-orchestrator.ts
  - electron/gateway/manager.ts
  - electron/gateway/supervisor.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/gateway-supervisor.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - harness/specs/tasks/fix-upgrade-state-ownership-recovery.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A Gateway that cannot acquire state ownership retains its original diagnostic in logs and fails instead of running an ineffective Doctor repair and repeating startup.
  - Stopping or superseding startup prevents the old flow from beginning Doctor repair or another startup attempt.
  - Genuine configuration or migration failures retain bounded automatic repair.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/gateway-supervisor.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-ws-client.test.ts
acceptance:
  - State-ownership contention diagnostics in stderr or the startup error take precedence over exit code 1 and Doctor suggestions.
  - Restart failure handling preserves the decision to disable reconnect after ownership contention instead of re-enabling automatic retry.
  - The field diagnostic waited for Gateway state ownership is not treated as a configuration failure; unrelated file-lock or SQLite errors are not broadly reclassified.
  - Ordinary startup failures are checked against the current lifecycle before any recovery side effect, and completed Doctor work cannot update a superseded startup.
  - Tests reproduce lock contention with exit code 1, ordinary child failure after stop, and cancellation while Doctor is in flight, while preserving real config repair.
  - No automatic deletion of locks, killing of an unverified holder PID, or modification of runtime databases is introduced.
docs:
  required: true
references:
  - harness/reference/openclaw-2026-10-5-upgrade.md
---

The 2026-11-04 09:20 UTC issue report never reached readiness in its 23-minute
capture window. The first Gateway spent about 207 seconds before the ownership
wait, then waited 301732 ms for holder PID 4324. Doctor failed on the same lock.
The lock had not renewed for roughly 4.8 days, but the report has no process
identity or lock metadata sufficient to distinguish a hung owner from PID reuse.
This change removes erroneous recovery work; it does not claim to reclaim the
holder or optimize the preceding runtime initialization.

## Validation

- Eight targeted Gateway test files passed: 132 tests, including ownership
  failures through actual manager restart flow, ordinary exit after stop,
  Doctor preparation cancellation, and cancellation on Doctor resolve/reject.
- Node and web TypeScript checks passed. Full ESLint passed with no errors
  and seven existing renderer fast-refresh warnings; changed files also passed
  targeted lint after the final edits.
- Communication replay and baseline comparison passed with the Windows URL-path
  workaround documented in `harness/reference/local-061-upgrade-validation.md`;
  the unmodified scripts return successfully without executing on Windows.
  Harness task validation
  against HEAD, task dry-run, and harness CI passed (22 baseline tests).
  The existing harness parser requires LF frontmatter; checks temporarily
  normalized local spec line endings and restored the original bytes afterward.
- Follow-up validation installed the locked dependencies and exercised the
  official Windows 0.6.1 app against a packaged working-tree build with
  OpenClaw 2026.10.5. Migration and subsequent concurrent chat succeeded; see
  `harness/reference/local-061-upgrade-validation.md` for timings, failures and
  coverage limits. Controlled runtime probes reproduced a legacy lock without
  process-start identity blocking on an unrelated live PID. This does not prove
  that PID reuse caused the supplied incident or reclaim its unknown holder.

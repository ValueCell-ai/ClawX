---
id: stabilize-openclaw-upgrade-e2e
title: Repair failures in the full Electron E2E suite after the OpenClaw upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Run the complete Electron E2E suite, diagnose failures from evidence, and correct test synchronization or application defects without weakening protocol and session guarantees.
touchedAreas:
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-skill-trigger-i18n.spec.ts
  - tests/e2e/computer-use-skill.spec.ts
  - tests/e2e/voice-dictation.spec.ts
  - tests/e2e/cron-system-jobs.spec.ts
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/e2e-parallelism.md
  - harness/specs/rules/e2e-parallel-isolation.md
  - tests/unit/e2e-parallel-policy.test.ts
  - harness/specs/tasks/stabilize-openclaw-upgrade-e2e.md
expectedUserBehavior:
  - Restart continuation and completion remain visible in the original conversation.
  - The full Electron suite exercises isolated functional tests and host performance profiles under the default worker policy.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - e2e-parallel-isolation
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run test:e2e
  - tests/unit/e2e-parallel-policy.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
acceptance:
  - Initial complete-suite results and focused reproduction evidence identify failures before code changes.
  - Test synchronization observes actual host requests and UI state rather than depending on arbitrary delays.
  - Restart fixtures model a transient incomplete catalog and eventual catalog recovery while preserving meaningful completion assertions.
  - Existing session, generation and communication boundaries are retained.
  - Particularly flaky cases may be removed only with recorded evidence and an explanation of the lost coverage; test timeouts are not treated as proof of flakiness by themselves.
  - The final complete E2E invocation passes under the default project dependency graph and worker policy, with platform-specific skips reported separately.
docs:
  required: false
---

The user authorized running all E2E tests, fixing failures and removing particularly
flaky cases where justified. Baseline artifacts are saved under ignored
`artifacts/review/e2e-full-20261028/`. Update touched areas and validation anchors
when additional failures are diagnosed. Review the three README files if changes
affect application behavior or test workflows.

Initial full invocation: 183 passed, 14 failed, four pre-existing skips and two
performance tests blocked by the project dependency graph (203 collected).
Failures: two Main-window startup timeouts; one restart catalog fixture that
never recovered its omitted row; ten skill/voice cases lacking ACP load mocks;
one cron case bypassing the production Main filter with a final-response mock.
Keep every case and repair the fixture boundaries. No removal is justified by
this evidence.

Reviewed README.md, README.zh-CN.md and README.ja-JP.md: public application behavior
and testing commands are unchanged. Internal fixture policy is updated in the
existing E2E reference and rule. Failed tests now preserve their isolated Main
logs before temporary-profile cleanup.

## Final validation (2026-10-28, macOS arm64)

- Complete `pnpm run test:e2e --reporter=list,json,html`: **199 passed,
  4 pre-existing skips, 0 failed, 0 flaky**, 203 collected, about 5.2 minutes
  excluding the production build. Both host performance profiles ran and passed.
- Four unchanged skips: Windows-only chat title, Windows-only title-bar chrome,
  Windows-specific minimize/zoom lifecycle, and the already-skipped internal
  token-usage overview case. No case was removed or newly skipped; assertion
  and timeout budgets were not relaxed.
- Focused reproduction: the other 13 initial failures passed after fixture
  repairs; the corrected restart case passed five repeated runs with two workers.
- Full typecheck and full lint passed (0 errors, 7 warnings in unchanged files).
  34 related unit tests, comms replay/compare, task validation against HEAD,
  selected-flow dry run and harness CI passed.

The fixes are confined to E2E fixtures/specs and their Harness documentation:
Main readiness before IPC replacement; explicit keyed ACP empty-load mocks for
provider-free composer tests; a valid transient/recovered restart catalog; and
production Main cron filtering exercised below the typed host response.
Application runtime behavior is unchanged.

Reports and first-run failure evidence remain under ignored
`artifacts/review/e2e-full-20261028/`. The final HTML entry is
`final-html/index.html`; structured results are `final-run.json`.

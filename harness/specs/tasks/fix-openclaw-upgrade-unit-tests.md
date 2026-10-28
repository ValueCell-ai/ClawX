---
id: fix-openclaw-upgrade-unit-tests
title: Repair stale unit assertions after the OpenClaw upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore the complete unit suite while keeping behavioral coverage for current ACP compaction routing and localized export accessibility.
touchedAreas:
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/issue-report-export.test.tsx
  - harness/specs/tasks/fix-openclaw-upgrade-unit-tests.md
  - harness/specs/tasks/fix-openclaw-2026-10-5-acp-compaction.md
expectedUserBehavior:
  - The standard pnpm run test command passes without changing application behavior.
  - Agent and session-operation compaction events reach their shared scoped ACP projection.
  - The collapsed export shortcut retains its translated accessible name and icon-only appearance.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run test
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-compaction-runtime.test.ts
  - tests/unit/issue-report-export.test.tsx
acceptance:
  - The initial complete invocation identifies actual assertion failures rather than treating expected diagnostic stderr as test failures.
  - Compaction routing coverage executes installed translator methods instead of asserting the spelling of a retired helper call.
  - Routing tests preserve tool dispatch, native recovery lineage, passive projection and rejection of unrelated operations.
  - Export accessibility assertions use a deterministic real translation and verify the collapsed shortcut has no visible label.
  - The final complete unit invocation passes with existing intentional skips reported separately.
docs:
  required: false
---

Initial full run on Node 24.18.1: 230 test files, 2809 passed, 2 failed,
3 skipped. The ACP guard expects a retired direct helper call; the export
shortcut expects a raw i18n key while the component correctly exposes its
English translation. Evidence is saved under ignored
`artifacts/review/unit-full-20261028/`.

These changes update regression coverage only. README.md, README.zh-CN.md and
README.ja-JP.md were reviewed; no application flow or public test command changed.

## Validation

- Focused run: 19 tests in the ACP stream, installed ACP compaction runtime and
  issue-export component suites passed.
- Exact `pnpm run test`: **230 files passed; 2813 tests passed, 3 existing
  skips, 0 failures** (2816 total, about 35 seconds on Node 24.18.1).
- Added routing behavior coverage for run-owned/ambient tools, both compaction
  event shapes, recovery lineage, passive projection and ignored unrelated or
  malformed operations. Existing child-process tests retain end-to-end ACP
  metadata and replay coverage.
- The export test explicitly selects and restores its locale, compares against
  the real English resource, and checks that the collapsed label stays hidden.
- Full typecheck, changed-test ESLint, comms replay/compare, task validation,
  selected-flow dry run and harness CI passed.

Final output: ignored `artifacts/review/unit-full-20261028/final-run.log`.
Application code and dependency patches are unchanged.

---
id: fix-auth-readiness-fixture-timeout
title: Keep auth readiness fixture and binary checks within CI timeouts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove unnecessary SQLite fixture commits and recursive Buffer matcher overhead that put read-only auth admission regressions near the five-second test timeout under parallel CI load.
touchedAreas:
  - tests/unit/openclaw-auth-readiness.test.ts
  - harness/specs/tasks/fix-auth-readiness-fixture-timeout.md
expectedUserBehavior:
  - Auth readiness regressions continue to exercise real on-disk runtime schemas and prove that pending or invalid stores remain unmodified.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
requiredTests:
  - tests/unit/openclaw-auth-readiness.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
acceptance:
  - Build each shared or agent fixture schema and its metadata in one explicit transaction, then close it before calling production admission.
  - Retain the real bundled schemas, read-only assertions, per-test isolation, default SQLite durability and existing test timeouts.
  - Compare full database bytes with native Buffer equality rather than recursively enumerating megabyte-sized Buffer properties.
  - Measure fixture construction separately from total test time and compare unchanged logical schema, metadata and database integrity.
  - Validate the affected suite and related SQLite tests, including a concurrent isolated run.
docs:
  required: false
---

The reported full-suite run passed 3199 tests but timed out two shared-state
admission cases at five seconds. The shared fixture contains 100 tables and
121 indexes; its helper originally ran the DDL and metadata in autocommit mode.
This task changes fixture construction and binary assertions, not product persistence behavior.
README.md, README.zh-CN.md and README.ja-JP.md require no product-flow updates.

Windows validation used Node 24.20.0 with the pinned OpenClaw runtime. The
unchanged readiness suite passed locally, but the two reported cases took
3465 ms and 3372 ms, leaving little margin below their 5000 ms CI limit.
This reproduces expensive fixture setup, not the exact CI timeout schedule.

Alternating standalone shared-fixture runs measured 1611-1623 ms with automatic
commits and 18-20 ms inside a transaction (three of each). Schema definitions,
metadata and header markers were identical; all six databases passed integrity
checks and retained journal_mode=delete and synchronous=2. Schema-helper loading
was measured separately at 357 ms for that process.

The modified readiness and auth SQLite suites passed all 31 tests. Four parallel
isolated copies of readiness passed all 60 tests; the two reported cases took
1941-1998 ms. Every copy used its own random profile and was removed afterward.
No global or per-case timeout, admission assertion, product code or SQLite
durability setting was changed. Measurements remain under ignored
`test-results/auth-readiness-timeout/`.

Targeted ESLint, diff checks, task validation against HEAD and the task dry-run
passed. Harness CI passed its 22 baseline tests using the existing temporary
Windows frontmatter LF normalization; original spec bytes were restored.

## Binary assertion follow-up

A later CI run still timed out the two shared-state read-only cases after
5524 ms and 5562 ms. The real shared schema file is about 1.45 MB; Vitest's
`toEqual` recursively compares its Buffer elements and enumerable properties.
The transaction optimization removed repeated SQLite commits but left this
matcher cost. All six binary before/after assertions now use `Buffer.equals()`
and assert the boolean result. This still detects every changed byte, including
schema headers and markers, without changing timeouts or admission behavior.

The follow-up passed all 31 readiness/auth-SQLite tests on Windows. Readiness
also passed in the full local unit run, but that run was not green: 23 other
test files failed with platform permissions/path/shell issues and separate
runtime/import failures. The full-suite CI check runs on Ubuntu and remains
the cross-platform verification for this follow-up.

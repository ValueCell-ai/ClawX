---
id: fix-auth-readiness-fixture-timeout
title: Keep native auth readiness regression checks within their test budget
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Avoid unnecessary fixture commits and generic deep comparisons of large SQLite buffers while retaining exact read-only auth admission checks within the five-second test timeout under parallel CI load.
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
  - Compare complete before-and-after database bytes with native Buffer equality, without object-property traversal or weakening the immutability assertion.
  - Measure fixture construction separately from total test time and compare unchanged logical schema, metadata and database integrity.
  - Validate the affected suite and related SQLite tests, including a concurrent isolated run.
docs:
  required: false
---

The reported full-suite run passed 3199 tests but timed out two shared-state
admission cases at five seconds. The shared fixture contains 100 tables and
121 indexes; its helper originally ran the DDL and metadata in autocommit mode.
This task changes only fixture construction and binary assertions, not product persistence behavior.
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

## Byte comparison follow-up

PR #1337 still reached 5462 ms for the old shared-state admission case under the
full Linux CI suite. With transactional fixtures already in place, a local
isolated run passed but the old shared-state case took 2240 ms and the complete
readiness suite spent 10.87 seconds in tests. Cases without full database buffer
comparisons were much faster. Replace generic deep equality for SQLite file
buffers with exact native byte equality and measure the affected cases again.
Keep the production admission checks, complete before-and-after file reads,
default five-second timeout and schema fixture durability unchanged.

The real old-state fixture was 1,454,080 bytes. Transactional construction took
26.6 ms, Vitest's generic equality comparator took 1821.9 ms, and native
`Buffer.equals` took 0.153 ms. Native comparison also rejected a last-byte change
and a length change. With the byte assertions replaced, the previously failing
case took 37 ms locally. This removes assertion overhead while retaining the
complete file immutability check.

The readiness and related auth SQLite suites passed all 31 tests after the
change. Targeted lint, diff-aware task validation and dry-run against the
preceding UI commit passed; harness CI passed its 22 baseline tests.

# Windows upgrade Doctor performance, 2026-11-09

Task: `harness/specs/tasks/optimize-windows-doctor-upgrade.md`.
Baseline correctness and isolation details are in
[Windows SQLite upgrade validation](windows-sqlite-upgrade-validation-20261109.md).
Machine-local measurements are retained under ignored
`test-results/windows-upgrade-20261109/doctor-performance/`.

The starting corrected package took 82.2 seconds in Doctor for main and
79.8 seconds for official 0.6.1. These are whole repair-process measurements,
including inspection, backups and non-database checks, not SQL-only timings.
The prior correctness fixes were committed and pushed as `23778449` before
performance work. The subsequent experiment did not establish an end-to-end
benefit, so no production performance change was adopted.

## Measured work

An isolated fresh main upgrade with upstream startup tracing took 104.837
seconds in Doctor. Non-overlapping top-level traced intervals were:

| Interval | Seconds |
| --- | ---: |
| Maintenance begin (includes original-state capture) | 14.018 |
| Database preflight | 0.275 |
| Configuration flow | 35.828 |
| Doctor contributions | 44.139 |
| Maintenance ready/release | 0.878 |
| Outside these intervals | 9.699 |

Nested intervals must not be added to their parents. Configuration snapshots
took 14.807 seconds and legacy-state migration took 11.639 seconds within
configuration flow. Contributions included runtime tool schemas (16.847
seconds), session transcripts (8.823 seconds), security (5.627 seconds), and
legacy plugin source captures (2.463 seconds). Earlier migration logs put
the agent SQLite schema migration/integrity work around 1.6 seconds; the
whole Doctor duration is not a SQLite migration duration.

A separate restored main run with process telemetry and a root-process CPU
profile took 65.4 seconds in Doctor. It observed 31 child-process calls across
19 processes. Sampled root-process file I/O accounted for about 28.53 seconds,
including 22.29 seconds below the plugin module loader and 14.55 seconds below
plugin source hashing. These are sampled inclusive stack attributions, not
file operation counts or proof that identical files were redundantly read.
Root-process JavaScript compilation accounted for about 1.07 seconds; child
compilation has not yet been attributed.

The 65.4–104.8 second spread demonstrates significant run/environment variance.
Single before/after runs cannot substantiate an optimization. An ignored
diagnostic wrapper is prepared to test the upstream versioned compile-cache
resolver while preserving explicit cache/disable settings, but it has not yet
been run. File identity, native root-bound opens, snapshot ownership and backup
checks remain mandatory; none have been bypassed for profiling.

Enterprise upgrade coverage was added while this investigation was in progress;
see [enterprise validation](enterprise-windows-upgrade-validation-20261109.md).

## Root-file batch experiment

After the enterprise startup and shutdown fixes, both community baseline routes
were exercised against the same rebuilt host package. Its OpenClaw 2026.10.10
runtime retained the previously validated migration fixes. An ignored diagnostic
loader replaced one function in memory only: `assertPluginNativeReferenceDirectory`
used one existing `createRootFileOpenBatchSync` scope for that synchronous directory
validation. File hashes, per-file identity checks, final admission, error handling
and disposal remained in the candidate. The source package was unchanged.

Control and batch runs used the same loader and root-process CPU profiler.
The loader verified the exact module URL and original/overlay SHA-256 values.
All four runs recorded exactly one target load, a valid exit and unchanged source
bytes. The hook affected only the root Doctor thread; child workers and processes
retained their original implementation. A production patch would have wider
process coverage and was not tested by this experiment.

Main ran control then batch; official 0.6.1 ran batch then control. Each arm
restored the saved logical baseline, completed an upgrade, and then completed an
ordinary restart with profiling and the source hook disabled. All four upgrades
and four restarts passed chat/history, database and four-channel checks. Every
ordinary restart required zero Doctor repairs.
The community runner stops GatewayManager before closing the app; independent
native application-quit coverage is recorded in the enterprise report. Only the
control arms exercise the unchanged runtime implementation throughout.

| Baseline | Mode | Doctor seconds | Upgrade ready seconds | Ordinary restart ready seconds |
| --- | --- | ---: | ---: | ---: |
| main | Control, first | 59.960 | 111.510 | 26.360 |
| main | Batch, second | 56.783 | 122.449 | 25.397 |
| official 0.6.1 | Batch, first | 59.703 | 135.612 | 25.696 |
| official 0.6.1 | Control, second | 59.185 | 133.792 | 24.687 |

Doctor timings here are the diagnostic root-process elapsed intervals, not the
slightly longer outer host log interval around repair launch and completion.

Main's Doctor interval was 3.177 seconds shorter with batching, but upgrade
readiness was 10.939 seconds later. On 0.6.1, batching took 0.518 seconds longer
in Doctor and reached readiness 1.820 seconds later. These observations establish
neither a causal Doctor speedup nor an end-to-end improvement.

The restore helper restores only children present in the baseline snapshot's
`restoreRoots`. Newly created roots can survive between arms. In particular,
0.6.1's baseline had no `.openclaw/tmp`, so later native captures and caches there
were not reset. Logical config, agent, state and plugin inputs were restored;
this was not a complete cache reset. OS filesystem caching, scanning and general
run variance also remained uncontrolled. Reversing order across two different
baseline routes does not make them repeated samples of one controlled workload.
The correctness results remain valid; these limits constrain performance claims.

## CPU attribution and decision

Offline analysis reused the original I/O attribution algorithm and compared
root-process CPU stacks without loading the runtime or starting an application.
The following are inclusive sampled I/O seconds, not operation counts:

| Stack scope | main control | main batch | 0.6.1 control | 0.6.1 batch |
| --- | ---: | ---: | ---: | ---: |
| Target directory-validation function | 7.931 | 6.961 | 8.925 | 8.079 |
| Target root-path/final-admission descendants | 1.253 | 0.346 | 1.460 | 0.410 |
| Target one-shot root-open descendants | 7.054 | 0.000 | 7.999 | 0.000 |
| Target batch-open descendants | 0.000 | 6.136 | 0.000 | 7.091 |
| Existing receipt batch outside target | 5.988 | 5.814 | 6.321 | 6.042 |

These scopes overlap and must not be added. The one-shot stack moved into the
batch-open stack; its disappearance does not represent a seven-to-eight-second
saving. Most per-file opening work remains. The target's sampled I/O was about
0.97 seconds lower for main and 0.85 seconds lower for 0.6.1, while unrelated
receipt batches also varied. This is a small mechanism observation subject to
the same cache and environment limits, not a reliable production benefit.

CPU samples cannot count filesystem calls, files, root handles or security
checks. Missing frames do not prove a guard was skipped, and synchronous security
stacks omit asynchronous continuations. The 0.6.1 control profile contained two
negative 10-microsecond deltas; analysis retained the original signed values and
recorded the combined -0.02 milliseconds instead of rewriting the profile.

The candidate remains diagnostic-only. No performance patch was added to the
runtime or lockfile, and no further expensive checkpoint/repeat matrix was
justified by these results. Existing compile-cache experiments also remain
unadopted. The durable result is the measured cost breakdown and successful
upgrade/restart coverage of the corrected host.

Evidence under the ignored performance directory:

- `ab-main-final-perf-host-main-a2-perf-host-main-b2/summary.json`
- `ab-061-final-perf-host-061-a1-perf-host-061-b1/summary.json`
- `main-open-batch-cpu-a2b2/comparison.json`
- `061-open-batch-cpu-a1b1/comparison.json`

## Upstream Doctor scope boundary

OpenClaw 2026.10.10 has no public schema-only Doctor option that preserves all
required backup, admission, config, auth and plugin migrations. `--only` and
`--skip` apply to read-only `--lint` and cannot accompany `--fix`. `--post-upgrade`
is a plugin compatibility probe; session SQLite operations and shared-state
compaction do not replace the complete repair flow. The hidden externally
supervised `update migrate` protocol also calls the full Doctor and adds its own
backup/receipt/acceptance lifecycle.

The upstream managed updater has a separate reported-checks protocol that can
move eligible advisory inspections after verified Gateway readiness. It records
the target's exact deferred check IDs, consumes that receipt, runs the matching
read-only lint checks, verifies completion and records incomplete work. Among the
earlier large traced contributions, only runtime tool schemas (16.847 seconds)
qualifies. Session transcripts (8.823 seconds) owns repair work; security (5.627
seconds) is explicitly marked as post-plugin readiness. Both stay before startup.

ClawX's standalone Doctor repair currently has no such updater receipt/selector
and post-readiness completion protocol. Setting updater environment markers
alone would also change config/plugin deferral, service and failure semantics;
it is not an acceptable optimization. A future protocol integration would need
owned durable pending work, version gating, lifecycle cancellation/retry and
visible results while retaining every migration and admission boundary. It would
move some work after readiness rather than eliminate it. No such integration was
implemented or benchmarked here.

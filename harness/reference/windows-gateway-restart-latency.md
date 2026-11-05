# Windows Gateway restart latency

Date: 2026-11-05. Task: [fix Windows Gateway restart latency](../specs/tasks/fix-windows-gateway-restart-latency.md).

The [0.6.1 upgrade validation](local-061-upgrade-validation.md) measured full app
launches after migration. This follow-up measures actual in-app restarts and
identifies the expensive operations before applying a production fix.

## Scope and retained evidence

- Baseline: `de8982e`, branch `feat/openclaw-2026-10-5`; OpenClaw `2026.10.5`,
  Electron `41.10.7`, embedded Node `24.18.0`.
- Synthetic fixture: `D:/ClawX-upgrade-validation-20261104/fixtures/upgrade-basic/`.
  Preserve this absolute path because state contains absolute database paths.
  The read-only golden clone is never launched. No real credentials are used.
- Diagnostic evidence: `D:/ClawX-restart-investigation-20261105/`;
  `restart-investigation-summary.json` maps runs, queried PIDs and source hashes.
- Final repair evidence: `D:/ClawX-restart-fix-20261105/`.
- Local Gateway/model ports: `28789` / `28790`. The bootstrap isolates profiles
  and suppresses window-focus, login-item and user-PATH side effects.

## Measured causes and fixes

| Baseline package | Initial app launch | In-app restart 1 | In-app restart 2 |
| --- | ---: | ---: | ---: |
| Uninstrumented | 45.754 s | 20.297 s | 42.177 s |
| CPU/filesystem profile | 47.804 s | 15.146 s | Not run |

All cycles reached full readiness and read both fixture sessions. No Doctor ran.
The two baseline stop waits took only 208 ms and 180 ms; most of the variable
cost was in the new process. Evidence: `baseline-2026-11-05T034811006Z/` and
`profile-2026-11-05T035102406Z/`, including V8 CPU profiles.

### Repeated identity queries for an exited owner

The slow profile spent 22.432 s of its 47.457 s sampled interval in synchronous
native spawn calls: blocked wall-time samples, not JavaScript CPU usage.
Process-start lookup launched PowerShell 69 times (10.222 s) and WMIC 69 times
(12.004 s). The fast restart launched neither. Both used the same compile cache:
6,857 files, 25,586,684 bytes.

The call path was state-database access, stale-owner inspection, process-start
lookup, then PowerShell/WMIC fallback. The original code queries creation time
before checking definitive death. For an exited PID, native `OpenProcess` fails
and the expensive fallbacks cannot recover live identity. Metadata traces
confirmed all 138 queries targeted the preceding isolated Gateway and returned
`ESRCH` before lookup. This does not establish the older field report's lock
holder identity.

The patch adds an early definitive-death check to all eight shipped copies of
`inspectStaleLockOwner`. Live or unknown owners retain creation-time comparison
and the final death check, including exit during lookup. It introduces no PID
cache or arbitrary lock deletion. On Windows, permission-denied or unknown
outcomes do not qualify as definitive death.

| Same fixture, standard PowerShell PATH, metadata-only | Initial start | PID-start PowerShell / WMIC |
| --- | ---: | ---: |
| Original runtime | 51.380 s | 69 / 69 |
| Early-death candidate retaining final recheck | 28.027 s | 0 / 0 |

Evidence: `metadata-2026-11-05T040406145Z/` and
`metadata-2026-11-05T040616057Z/`. Both separate boot-identity queries succeeded.
This small comparison saved 23.353 s (about 45%). Earlier restricted-PATH runs
omitted that separate boot query; an early prototype omitted the final death
recheck. Neither is the final candidate. Details remain in the summary JSON.
The experimental package was restored to its original SHA-256:
`94a01b0cec4d30b6ab8b343f4b2e9764d8d46cd0a977cf222d51a05001b0257e`.

### Unsupported shutdown request

The runtime rejects the old `shutdown` RPC; its similarly named entry is an
event. ClawX therefore forcibly ended its utility child with exit code 1,
leaving ownership and unclean-boot recovery work for the next start. Both slow
and fast baseline restarts did this, so it does not alone explain timing variance.

The owned Gateway launcher now explicitly enables a private Electron parent-port
shutdown channel. The bootstrap dispatches to installed `SIGTERM` handlers,
independent of WebSocket readiness, and consumes the enable marker before runtime
import. Doctor and other CLI children never opt in. ClawX waits for actual exit,
not acknowledgement; only code 0 is logged as clean. Missing handlers, rejection
and a twenty-second deadline retain forced cleanup. External Gateway handling is
unchanged. Parent-port reply failure cannot interrupt runtime cleanup.

The first production-package validation exposed the old eight-second limit as
too short: the first restart entered the real handler but was killed before its
global cleanup completed; a subsequent stop exited cleanly in 6.703 s, including
5.267 s draining global singletons. These nested close stages must not be summed.
The 20-second limit is a bounded desktop policy, not a promise to wait the runtime's
full 325-second active-work drain budget. App quit allows cleanup to finish, with
a 30-second overall cap covering ACP stop and forced-stop fallback. Successful
cleanup returns immediately. Evidence: `production-2026-11-05T062527772Z/`.

### Empty Windows spawn brokers wait 5.25 seconds each

Increasing the outer deadline alone was insufficient: a later stop spent 5.449 s
closing agent databases and 11.041 s closing plugin state databases, then reached
the 20-second deadline before global cleanup completed. Evidence:
`production-2026-11-05T064134537Z/`. Another full three-PID run closed cleanly,
but still took 34.715 / 24.752 s per restart (`production-2026-11-05T063345433Z/`;
its runner initially failed only to collect the Electron exit code after close).

`dist/process/spawn-broker/worker.js` checks a Unix process group before allowing
an empty broker to exit immediately. On Windows the `/bin/ps` census fails,
returns unknown, and takes the fixed 5,250 ms fallback. Multiple brokers closing
in sequence can accumulate this delay. That census is advisory; the deadline
does not recheck it or establish Windows descendant ownership.

A targeted diagnostic observed an empty broker with all three collection sizes
zero: `/bin/ps` failed with `ENOENT` in 1 ms, selected the 5,250 ms timer, and
exited after 5,257 ms. Its Gateway's global-singleton close took 5,273 ms. Evidence:
`shutdown-diagnostic-2026-11-05T065026679Z/shutdown-broker-summary.json`. This
diagnostic used a 60-second observation window, not the production policy; the
temporary worker instrumentation was restored to its original SHA-256 afterward.

The fix retains the original disconnect, termination and exit actions, but skips
that Unix-only advisory check on Windows only when owned processes, pending starts
and native resources are all empty. Any nonempty collection retains the existing
delay and cleanup; unknown Unix process groups still retain their original wait.

### Partial webhook completion hides machine state

The fixture config records empty completion for `telegram`, `feishu` and
`nextcloud-talk`, but lacks `msteams`; machine state has all four. The old startup
gate reads only config, and migration uses `config ?? machine`, hiding the full
machine marker. Each start repeats the retained MSTeams doctor contract, reports
`msteams: []`, writes it to machine state, and revalidates config/plugins.

Startup gate and migration now share a resolver. Explicit config decisions win.
For partial config, machine state can fill only an empty decision for an absent
channel without legacy plugin-entry config or environment-only Teams settings.
It cannot restore historical pin paths or suppress migration for restored config.
Config `true` stays complete; machine `true` does not override partial config.
The startup gate retains the original normalizers when any historical channel
has config or the config marker is missing. The migration's inner fallback for
missing config markers is unchanged. Optional partial-marker lookup failure
keeps the original migration path; complete config markers need no lookup. Some
configured-channel cases deliberately remain unoptimized. Actual callback
migration and config-concurrency checks remain.

The original slow trace's 2.263 s webhook step and 7.337 s second validation
include the process-probe hotspot. Do not add them as independent savings.

## Validation and cleanup

Focused regressions live in the existing utility-process, Gateway launcher/restart
and OpenClaw patch suites. They execute generated bootstrap control and extracted
shipped runtime functions, including PID reuse, uncertain ownership, duplicate
requests, bounded fallback and restored channel config. Patch files use LF on all
platforms because pnpm hashes their bytes.

The final runner uses the production ASAR/runtime, with profile isolation but no
CPU/filesystem/spawn instrumentation or replacement shutdown code. It performs
`start()`, two `restart()` calls, then quits the app while its Gateway is still
running. The first runner's post-close Playwright handle lookup was corrected to
retain the process handle before exit; historical failed results were preserved.

Final focused suites passed across their recorded runs: utility bootstrap 16,
launcher 7, restart recovery 15, diagnostics 17, app quit 11 and runtime patch 10
(76 tests). The broader Gateway group was also exercised; its stale RPC shutdown
fixture was updated and the affected suite rerun without relaxing timing checks.
The native admitted-routing test now creates and cleans its own isolated profile
instead of reading the developer's OpenClaw state. No new test file was added.

Typecheck, lint (zero errors, seven existing renderer warnings), real comms replay
and comparison, task validation against `HEAD`, task dry-run and harness CI passed
(22 baseline tests). Windows checks temporarily normalized spec frontmatter to LF
and used `fileURLToPath` in the comms entry points to avoid their silent Windows
no-op; every temporary edit was restored byte-for-byte. See
`final-harness-comms-results.json` and the matching logs in the repair evidence
root. The unrelated full unit/E2E suites from the earlier upgrade validation were
not repeated or claimed green. Windows x64 directory packaging also passed;
this is not an installer overwrite test.

### Final production package

Evidence: `production-2026-11-05T065746349Z/result.json`,
`restart-fix-validation-summary.json` and `timings.json` in the repair root.

| Operation | Request to full readiness | Old process stop |
| --- | ---: | ---: |
| Initial Gateway start | 20.243 s | Not applicable |
| In-app restart 1 | 35.800 s | 17.159 s |
| In-app restart 2 | 18.150 s | 0.301 s |

All three owned Gateways exited with code 0, recorded `clean_stop`, and released
their state/agent leases and owner locks. Quitting the app with a live Gateway
took 0.822 s (Gateway exit at 0.733 s); Electron also exited 0. Both fixture
conversations retained all eight messages and old/new markers. The 24-file
pre-migration backup and original log prefixes remained unchanged. Final checks
found no isolated processes, test-port listeners or test entries in user PATH.
Each startup performed one config validation and no webhook-readiness migration.

**Remaining limitation:** the first stop still spent time on three shared-state
SQLite `TRUNCATE` checkpoints with the existing 5-second busy timeout. Their
diagnostics showed 41 WAL frames with 7 checkpointed, but only current-thread
connections and an unknown blocking owner. This is distinct from the fixed empty
broker delay. No old worker source copy was found. A separate Electron/SQLite
probe verified that ordinary `all()`, `get()` and cached Kysely `get()` reads did
not reproduce the block, while a live iterator or explicit read transaction did.
See `remaining-close-wait-evidence.json` and `sqlite-reader-probe.results.json`.
The actual reader remains unidentified; checkpoint mode, durability, busy timeout
and database locks were not weakened to obtain faster timings. Do not present
every restart as fast or this remaining performance issue as resolved.

Cleanup removed 26 superseded diagnostic/duplicate files (193,900 bytes), after
absolute-path, plain-file and SHA-256 checks. `cleanup-result.json` records each
deletion. JSON/log/CPU evidence, installers, upgrade fixtures/golden, the complete
old-to-new migration runner and the final restart runner remain. No unrelated
failing repository test was deleted to obtain a pass.

The additional `sqlite-reader-probe-PO3igQ` experiment directory remains: automatic
approval review rejected both its validated recursive cleanup and subsequent
explicit per-file deletion with `blocked by policy`, without a specific reason.
Its eight temporary SQLite files were not deleted; the experiment has no running
process. See `sqlite-probe-cleanup.json`. It is separate from the upgrade fixture.

## Interpretation limits

Bootstrap phases contain nested work and replayed records; do not sum them. CPU
sampling covers the main thread, and filesystem wrappers miss native loader work.
No security settings or Defender exclusions were changed; antivirus scanning has
not been established as a cause. This is a small synthetic fixture, not a
release-wide timing guarantee, installer overwrite test or large-history and
long-running-channel stress test.

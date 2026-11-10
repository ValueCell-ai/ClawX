# Windows SQLite upgrade validation, 2026-11-09

Related task is `harness/specs/tasks/validate-windows-sqlite-upgrade.md`.
The persistence contract is documented in `harness/reference/openclaw-2026-10-10-upgrade.md`.
Machine-local runners and evidence are under `D:/GItHub/ClawX/test-results/windows-upgrade-20261109/`.
Raw evidence remains ignored because it includes credentials and the supplied issue report.

## Field failure and reproduced cause

The supplied `clawx-issue-report-20261109-040046Z.zip` records this sequence on November 9. Times use Asia/Shanghai.

| Time | Observation |
| --- | --- |
| 10:49:44 | Agent admission aborts when deleting a temporary `database.sqlite` returns `EPERM`. |
| 10:50:19 | Doctor saves pre-migration database backups. |
| 10:50:37 | Snapshot cleanup failure becomes a configuration read failure and triggers last-known-good restoration. |
| 10:50:57 | Doctor reports agent schema migration from 25 to 27. |
| 10:51:48–51 | Doctor and CLI resource drainage report more cleanup failures. |
| 10:52:20 | A later Gateway retry becomes ready. |
| 10:57:03 | A subsequent Gateway start becomes ready. |

Relevant lines in the report's `logs/clawx/clawx-2026-11-09.log` include 376, 453, 498–499, 538, 613–615, 878, 917–919, 2470 and 4371. The retained pre-migration agent database passed an isolated integrity check.

Full packaged 0.6.1 upgrade runs reproduced the same cleanup failure. Doctor repeatedly restored configuration and exhausted startup repair attempts with workspace setup migration still pending. Restricting the test profile ACL did not eliminate the cleanup failure.

Native Windows handle inspection matched a failing temporary database to Doctor. `DatabaseSync.close()` tracing showed the SQLite connection had closed. Filesystem tracing then identified a separate retained `fs.openSync(..., 'r')` descriptor in the parent process, created by `retainSqliteDatabaseAdmissionLocation()` through plugin metadata reads. The deletion worker retired its own process-local admission entries, leaving the parent's identity descriptor open when unlinking the snapshot.

The minimal reproduction creates a read-only snapshot, acquires and releases an admission turn for it, then cleans up. Electron Node mode and utility mode both reproduce `EPERM`. Retiring admission in the owning host before deletion passes in both modes. The repair records the snapshot's admission locations and retires them in the host after the active-reader guard seals the snapshot. It preserves the existing reference-counted retirement and cleanup failure reporting. All nine bundled copies of this helper receive the same repair.

Evidence includes `native-snapshot-handles.jsonl`, `doctor2-sqlite-lifetime.jsonl`, and the `admission-*` result directories. Earlier ordinary snapshot, schema, WAL and retained-statement probes passed because they did not retain the parent admission descriptor.

A second independently reproduced Windows failure affects `withSqliteSessionImportStage`. Closing its native SQLite connection leaves a retained admission identity descriptor open; recursive removal of `openclaw-session-import-*` then throws `ENOTEMPTY`. The first repair alone let Doctor import both legacy conversations but aborted verification and archival. A later Doctor reported `sqlite_transcript_count_mismatch`, although all 12 SQLite events were deep-equal to the two original six-event JSONL files and database integrity was `ok`. The additional repair retires host admission after native close and before removing the import directory. It preserves callback errors and retains the directory if native close or admission retirement fails. A minimal Electron reproduction failed three times before the repair and passed three times afterwards, with no temporary directories left.

The main baseline exposed a separate compatibility omission. With Gateway auto-start disabled, saving a provider normally creates the agent database before the shared-state database. OpenClaw 2026.10.5 treats this as an existing installation and can omit the deletion journal. The preserved baseline shows an unchanged stable `2026.10.5`/schema-25 agent created 5,354 ms before its unchanged schema-20 shared database, whose deletion journal is absent. Both databases passed integrity checks. Target Doctor reconstructs the journal but its recovery producer list included only 10.5 beta releases, leaving this stable release held at schema 25. The new entry permits only the exact stable version/schema pair. All existing checks remain: configured agent/path, missing-journal receipt, no deletion record, unchanged producer identity/timestamps, maintenance authority, verified backups and revalidation before restoration. This is a specific provider-first initialization case, not a claim that every 10.5 upgrade is affected. Source and log references are recorded in `main-stable-cohort-evidence.txt`.

## Package provenance

| Component | Official 0.6.1 | Local main | Target before repair |
| --- | --- | --- | --- |
| Source | Official release installer | `6be7ae2c` | `66efd777`, `codex/work-20261107` |
| ClawX | 0.6.1 | 0.6.2 | 0.6.2 |
| OpenClaw | 2026.7.1-2 | 2026.10.5 | 2026.10.10 |
| Electron | 40.10.6 | 41.10.7 | 41.10.7 |
| Electron Node | 24.15.0 | 24.18.0 | 24.18.0 |

The official 0.6.1 installer has 287613960 bytes. Its SHA-512 base64 matches the previously recorded official manifest.

```text
X0Kp9CQO0p0JlZ9bAOR3OcLcA5fCQlfQZNsHJ1ICmH2wzXNWaUqTWwNtvCzFDEtDxuI3mIYwM0MoKmPntlNEQQ==
```

Main was exported with `git archive main`, installed using its frozen lockfile and built independently. Its packaged Main matches the compiled source. The generated main NSIS installer has 399504666 bytes and SHA-256 `a04a1cca23994a3aa932e0df911e6c6869f848427abb150a097c7a917774ee11`. Its extracted `app.asar` matches the tested directory package, SHA-256 `ef42a9f0b5079c21573f78b79d75d414e63483fd2990533bde9a6d169df02b15`.

Downloads returned HTTP 504. Packaging used an existing Electron distribution whose runtime versions matched the pins, and available NSIS/7-Zip tools. Main's helper binaries and preinstalled skills were reused after confirming identical downloader scripts and manifests. `main-package/main-provenance.json` records these substitutions.

The target was built from the current branch with its frozen dependencies. `target-final/win-unpacked` preserves the original package. `target-fixed/win-unpacked` copies it and replaces only the nine files enumerated by `runtime-snapshot-fix/files.json`. Its application archive is identical. Those files contain the same repair as the repository OpenClaw patch.

`target-complete/win-unpacked` adds the one import-stage repair in `runtime-session-import-fix/files.json`. Its application archive and all ten patched runtime files were checked against their source hashes before tests. Intermediate first-fix runs and packages remain separate from the combined repair.

`target-main-recovery/win-unpacked` additionally contains the single-file stable-10.5 recovery entry in `runtime-main-recovery-fix/files.json`. The unchanged application archive and all eleven runtime files passed hash verification. The main baseline was restored through the same offline helper before this package was exercised.

The final NSIS artifact is `installer-final/ClawX-0.6.2-win-x64.exe`, 411836960 bytes, SHA-256 `586601684f04a3dae129486ee8900ceb6df096864ba41de0993e3c82c80baa57`. Packaging uses the recorded `compression=normal` option. Extraction confirmed that `app.asar` and all eleven repaired runtime files match the tested package and the pnpm-installed patch, twelve hashes in total. Installer verification and provenance are retained beside the artifact. Earlier `installer-fixed` and `installer-complete` artifacts contain only subsets of the repairs and are superseded by `installer-final`.

## Isolation and exercise

`run-upgrade.mjs` uses the matching Electron executable with a dedicated launcher archive. `bootstrap.cjs` redirects Electron paths and loads the actual packaged Main entry with packaged, non-E2E initialization. It redirects HOME, USERPROFILE, APPDATA, LOCALAPPDATA, temporary paths and OpenClaw state/configuration. Gateway ports are 28789 and 29789. Local model servers use adjacent ports with synthetic credentials. OS login-item changes and the CLI user-PATH helper are intercepted in the isolated launcher.

The old packages create two conversations through normal Gateway RPC. The main baseline saves its synthetic provider credential through the packaged provider handler. Tests read assistant history, retain a marker in a Chinese workspace path containing spaces, and check databases after the app and Gateway close. Harness attempts with premature agent admission or inspection before full process close are retained as failed attempts and excluded from passing baseline results.

The combined-repair runner waits for `gatewayReady=true`, not merely a connected transport, before history assertions. Before its 0.6.1 rerun, the bundled offline restore helper verified and restored all 4,343 files from the original pre-migration snapshot. The wrapper verified every restore target remained inside the isolated fixture and that its processes and port were stopped. Displaced failed-upgrade state remains in the recovery journal.

The user authorized connection tests for QQ bot5, WeCom bot2, DingTalk bot6 and Feishu bot9. Profiles use these bots sequentially. Channel policies restrict incoming message processing. The test makes no outbound channel-message requests. Connection checks combine `channels.status` with timestamp-scoped runtime authentication/connection logs. Old WeCom's unconditional successful probe is insufficient alone.

Selected pre-upgrade state and workspace files are preserved with SHA-256 manifests under `profiles/*-pre-upgrade`. These audit copies retain absolute paths and are never launched as independent profiles.

## Baseline results

| Baseline | Two generated/read-back histories | Channel credentials | Four connections | Offline integrity |
| --- | --- | --- | --- | --- |
| `061-final` | Passed | All retained | Confirmed | Shared state schema 1, `ok`, no agent SQLite yet |
| `main-final` | Passed | All retained | Confirmed | Agent schema 25 and shared state schema 20, both `ok` |

DingTalk reports an established stream connection while an additional probe returns HTTP 403 on both old baselines and all four final upgrade/restart runs. These outcomes are recorded separately. This test does not establish external message delivery or the reason for that probe's 403.

Main history reads were slow and its logs reported blocked WAL checkpoints. A read-only inspector history request exceeded 45 seconds, although the normal runner eventually verified both assistant replies. One main launch exceeded the initial 120-second test allowance. Stack capture identified synchronous eager Discord SDK fallback imports in `electron/utils/openclaw-sdk.ts`. Retrying with a 300-second allowance completed the channel baseline. Observed import time was about 124 seconds. Concurrent packaging consumed disk and CPU, so these are diagnostic observations rather than benchmark results.

## Repaired package validation

The `upgrade-verified` runs use the same final three-fix directory package. Each begins from the verified old snapshot. Migration is performed by the packaged startup/Doctor flow, with no manual database edits or `agents add` repair. `restart-verified` then checks both pre-upgrade and post-upgrade replies without generating more messages. Four real bot connections are exercised sequentially across the two profiles.

| Route | Migration and full readiness | Old history and two new replies | Retained credentials/workspace | Four connections | Offline integrity | Restart |
| --- | --- | --- | --- | --- | --- | --- |
| main `6be7ae2c` → repaired branch | Passed | Passed | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |
| Official 0.6.1 → repaired branch | Passed | Passed | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |

Intermediate runs exposed a synthetic-model fixture error: 10.10 appends a user-role runtime-context message, so echoing the last user message returned that context instead of the test marker. The response was successfully committed with normal completion and usage, but the polling assertion never matched. The corrected server locates the explicit current marker among all user messages. A single 120-second history RPC timeout during that failed 0.6.1 polling run remains recorded; no SQLite corruption or lock-wait evidence established its cause. The main attempt already in flight with the old server was stopped gracefully after migration and old-history checks, then its original snapshot was restored for the corrected run. Neither failed attempt is counted as a passing full upgrade.

The offline restore guard also rejected a second 0.6.1 restore before publication when a new test process was detected. No live roots were replaced. That process completed a successful post-migration retry, retained separately as `upgrade-after-migration`; the subsequent fresh run started only after a new restore exited successfully. `summarize-validation.mjs` evaluates the designated final runs independently of their runner exit status and emits sanitized readiness, history, credential, connection, workspace and integrity assertions.

`validation-summary.json` records all four designated runs verified. Full Gateway readiness after `start()` took approximately 137 seconds for main and 157 seconds for 0.6.1; subsequent starts took about 25 seconds each. These exclude initial Main import and are observations under local test load, not performance guarantees. Both restart runs made zero model requests and verified retained replies from before and after upgrade. All test-owned applications/Gateways/model servers were stopped after verification; the isolated ports were no longer listening.

The final four logs contain no snapshot `EPERM`, import-stage `ENOTEMPTY` or incomplete shared-state snapshot cleanup warning. Both fresh upgrades still warn that native Doctor's additional original-state capture is unavailable because a repository ancestor grants access to `Authenticated Users`. The task did not alter the workspace/drive ACL. ClawX's separate pre-upgrade snapshots were successfully created, hash-verified and used for the offline restorations; native Doctor's additional capture path is not counted as validated under this directory ACL.

## Final current-host package regression

After the enterprise investigation, the community host was rebuilt with the
generic startup-preparation gate, native-store readiness checks, bounded exit
ordering and quit-time restart cancellation. The independent package is
`target-host-fixed-package/win-unpacked`, community 0.6.2 / OpenClaw 2026.10.10.
It retains the same eleven SQLite runtime repairs and adds the current host
changes. Its `resources/app.asar` SHA-256 is
`62063db9b48e8d89fe7b440cb201bd028e8d386c020d9e39bda92be24ad55aa2`.
The build records commit `23778449` plus the captured working-tree diff, whose
SHA-256 is `5a1a193d93ea9018270d84af3130f7bd69d0b68b46eb8673ca69da76e3da800b`.
Separate Main/renderer typechecks and the Vite build passed. Assembly verified
54,364 copied files, 2,655 retained archive files, 487 rebuilt files and all
eleven runtime-fix files; the earlier package and enterprise v2 archive remained
unchanged. Receipts are in `target-host-fixed-package/`.

Both original community baselines were restored through the verified core
snapshot helper and exercised against this package. The control upgrades used
the diagnostic loader and CPU profiler, but the loader returned the original
module bytes: both receipts record one load, equal source/evaluated hashes,
valid exit and unchanged package files. Their subsequent ordinary restarts
disabled the profiling and source hook. These control runs establish the final
package's unchanged-code regression result:

| Route / phase | Full Gateway readiness after Main initialization | Model requests | History, credentials and workspace | Four connections | Offline SQLite integrity | Result |
| --- | ---: | ---: | --- | --- | --- | --- |
| main `perf-host-main-a2` | 111.510 s | 2 | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |
| main `perf-host-main-a2-restart` | 26.360 s | 0 | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |
| 0.6.1 `perf-host-061-a1` | 133.792 s | 2 | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |
| 0.6.1 `perf-host-061-a1-restart` | 24.687 s | 0 | Passed | Confirmed | Agent 27 / shared 22, both `ok` | Passed |

Each upgrade read back both old assistant histories and two new replies; each
restart retained both generations without a new model request or Doctor repair.
All eight channel credential fields matched, the Chinese workspace marker was
retained, and all four apps exited with code 0. Connection verification requires
configured/running accounts plus an explicit connection or current-run
authentication evidence, and rejects explicit `connected=false`. The community
runner stops Gateway before closing the app; normal application-quit extension
cleanup is separately covered by the fresh-C enterprise runs in
[enterprise validation](enterprise-windows-upgrade-validation-20261109.md).

The main `perf-host-main-b2` and 0.6.1 `perf-host-061-b1` diagnostic candidate
upgrades and their ordinary restarts also passed the same functional checks.
Those candidate upgrades substituted one function in memory in the root Doctor
thread only. They are separate experimental evidence, not additional proof of
the final package's unmodified implementation. No production performance patch
was adopted. The observed timing and cache-carryover limits are documented in
[Doctor performance](windows-doctor-performance-20261109.md); these runs are not
unprofiled startup benchmarks or complete cache resets.

`current-host-validation-summary.json` independently checks all eight result
files and records both `finalPackageControlFourRunsVerified=true` and
`allEightRecordedRunsVerified=true`. It contains only marker-match booleans,
credential-match booleans, connection evidence status, schemas, integrity and
timings. The D: ancestor ACL limitation still applies: both control Doctors
explicitly refused the additional native original-state capture. Successful
core-snapshot restoration and database integrity do not establish that capture
path. No directory permissions were weakened or native capture guards bypassed.

The final current-host installer is
`installer-host-final/ClawX-0.6.2-win-x64.exe`, 411,836,291 bytes, SHA-256
`6b5931413a59776e5ff221a35f35052c9f809a64e70215fe885df8b5e684eb99`.
Its extracted `app.asar` matches the tested hash above, and all eleven repaired
runtime files match: twelve extracted hashes passed. The complete source
payload inventory and hashes also remain unchanged across all 54,365 files.
`latest.yml` size/SHA-512 checks passed; Authenticode reports `NotSigned`.
`installer-host-final/verification.json` records the completed verification.
This installer supersedes the earlier SQLite-only `installer-final` artifact
for delivery of the later host changes.

Packaging retained the frozen NSIS templates and used electron-builder 26.16.0's
existing `UninstallerReader` to extract the intermediate uninstaller without
executing it. The first post-build verifier expected a nested
`$PLUGINSDIR/app-64.7z`; its failed extraction log remains preserved. The final
independent verifier used 7-Zip's observed direct embedded-7z view at offset
635,340 and completed the checks above. Signing and publishing were disabled.
Although the configuration requested `compression=normal`, the actual embedded
archive used `-mx=9`; no compression speedup is claimed.
Neither installer nor packaged application was executed by the packaging or
verification helpers. NSIS registration, active-installation overwrite and
uninstall behavior remain untested. `final-installers-ready.json` records both
final editions and no remaining task processes or test listeners at completion.

## Checks and scope

The final focused run passed 87 tests across five files: the existing auth/startup suites, four descriptor-lifecycle cases and ten producer-eligibility cases. Each new fix had a failing baseline reproduction or regression before repair. The final dependency install with `--frozen-lockfile` passed; the OpenClaw patch hash is `5028de814f5cdebc00d0e7152c16d602301074dbb5a28347054861fc96ec7fcc`. Targeted ESLint, communication replay and comparison completed successfully. Node and web TypeScript checks passed.

Unmodified harness commands encountered the existing CRLF frontmatter parser limitation. Temporary LF normalization allowed task validation with `--since HEAD`, dry-run and harness CI to pass, including 22 baseline tests. All original spec bytes were restored. `harness-results.json` and `run-harness-normalized.ps1` retain the evidence and procedure.

The procedure exercises packaged Main and Gateway code against preserved profiles. It does not exercise NSIS registry registration, uninstall or installer overwrite of the user's active installation.

## Test-launch incidents

The first direct 0.6.1 executable launch ignored the test bootstrap argument. Its default-port cleanup affected the existing Gateway and its CLI helper added one test directory to user PATH. Test-created processes were stopped and that exact PATH entry was removed. The user then instructed the task to leave the existing ClawX alone, and recovery of that app was not continued.

A later diagnostic subtask also launched a packaged executable without the isolated launcher. Its test-created process tree was stopped after identifying the failure to enter isolation. Its effect on real configuration was not established. `diagnostic-launch-incident.json` records the known process/path evidence. Both direct-launch attempts are excluded from validated runs.

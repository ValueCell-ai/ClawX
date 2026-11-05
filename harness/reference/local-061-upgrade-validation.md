# Local Windows validation: ClawX 0.6.1 to OpenClaw 2026.10.5

Validation date: 2026-11-04. Related scenario:
[Gateway backend communication](../specs/scenarios/gateway-backend-communication.md).
Related recovery task:
[Upgrade state ownership recovery](../specs/tasks/fix-upgrade-state-ownership-recovery.md).

The isolated, real Gateway upgrade completed, retained the fixture data, and
served concurrent tool-using turns afterward. This is evidence for the tested
Windows package and small fixture, not a release-wide pass: the full unit suite
still had unresolved failures, and subsequent Gateway starts still took about
44–51 seconds. The original user-reported freeze and the identity of the field
report's lock holder were not established by this experiment.

Follow-up profiling on 2026-11-05 distinguishes these full application launches
from in-app restarts and identifies repeated Windows process-identity probes in
the stale-owner path. See [Windows Gateway restart latency](windows-gateway-restart-latency.md).

## Build and artifact provenance

All local evidence is under
`D:/ClawX-upgrade-validation-20261104/` (called the artifact root below). These
machine-local paths are retained for audit; the artifacts are not checked into
the repository.

| Component | Old baseline | Tested target |
| --- | --- | --- |
| Application source/package | Official ClawX `v0.6.1` Windows x64 release | Local Windows x64 directory package from `feat/openclaw-2026-10-5` |
| App package version | `0.6.1` | `0.6.1`; the package version alone does not distinguish these builds |
| OpenClaw | `2026.7.1-2` | `2026.10.5`, with the repository's pinned patches |
| Electron | `40.10.6` | `41.10.7` |
| Observed Electron Node | `24.15.0` | `24.18.0` |
| Application resources | `old-package/app/resources/` | `current-release/win-unpacked/resources/` |

The target was built from commit
`345e4442980d39c15338b086e50298d7f457eaa2` **plus uncommitted working-tree
changes**. In particular, the package included the Gateway ownership/cancellation
recovery fixes and Windows stale-plugin-path cleanup fix under review. It is not
an unmodified build of that commit or a published release. The Node TypeScript
configuration was also corrected during validation, as described below.

The old installer was downloaded from the
[official v0.6.1 release asset](https://github.com/ValueCell-ai/ClawX/releases/download/v0.6.1/ClawX-0.6.1-win-x64.exe).
Its size and SHA-512 matched the downloaded `old-latest.yml`:

- Size: `287613960` bytes.
- SHA-512, base64:
  `X0Kp9CQO0p0JlZ9bAOR3OcLcA5fCQlfQZNsHJ1ICmH2wzXNWaUqTWwNtvCzFDEtDxuI3mIYwM0MoKmPntlNEQQ==`.
- Manifest release date: `2026-10-23T07:24:43.726Z`.

The installer was extracted with a separately preserved 7-Zip executable, never
executed. The extracted ASAR and bundled runtime supplied the old application
and Gateway used in the test. Separately, `git archive v0.6.1` exported source
commit `126bdb361fb6ef40831f649fcc030e218a774bd5` into `old-source/`, and its Vite
build succeeded; that source build was a debugging baseline, not a substitute
for the official package in the upgrade experiment.

Build evidence: `current-build.log`, `current-bundle.log`,
`current-plugins.log`, `current-skills.log`, and `current-package.log` under the
artifact root. Per-launch `*-bootstrap.json` files record the actual Electron
and Node versions, application archive, resource directory, and isolated paths.
The pinned dependencies were installed with `corepack pnpm install
--frozen-lockfile`; the lockfile was unchanged. The skill bundler needed zx's
`usePowerShell()` selected explicitly on this Windows host after the standard
invocation failed to choose a quoting function. The directory package then
built successfully; this is not a claim that the unmodified full Windows
installer build command passed.

## Isolation and reproducible procedure

The sole live profile was
`D:/ClawX-upgrade-validation-20261104/fixtures/upgrade-basic/`, with separate
`home/`, `userData/`, and `tmp/` directories. The launcher supplied a restricted
environment and explicitly redirected `HOME`, `USERPROFILE`, `APPDATA`,
`LOCALAPPDATA`, `TMP`, `TEMP`, `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, and
`OPENCLAW_CONFIG_PATH`. No real user profile or provider credential was used.

Playwright launched the preserved matching Electron executable. Before loading
the package's actual `dist-electron/main/index.js`, the bootstrap set Electron's
home, app data, user data, session, logs, temporary and crash paths; selected the
actual ASAR/resources; and enabled packaged, non-E2E initialization. Only OS
login-item changes, window show/focus, and the package CLI helper's user-PATH
mutation were suppressed. Gateway spawning, application initialization,
configuration repair, migration, and RPC handling remained real.

An initial isolation probe revealed that the old CLI helper had added exactly
`D:/ClawX-upgrade-validation-20261104/old-package/app/resources/cli` to the real
HKCU user PATH. That exact test entry was removed, preserving all other entries
and the `ExpandString` registry value type. Subsequent launches intercepted only
that helper's `add` invocation. Final verification found zero matching test
entries. This correction is recorded rather than claiming that environment
variables alone isolated every Windows OS integration.

Gateway auto-start, automatic updates, telemetry, computer use, and login launch
were disabled in the test settings. The manager was explicitly assigned port
`28789` before manual `start()`. The deterministic model server bound only
`127.0.0.1:28790`. Both ports were asserted free before launching. No external AI
service was used. Normal app background catalog probes were still possible;
the recorded remote catalog fetches were blocked by runtime network policy.

The old application created two sessions through `sessions.patch` and
`chat.send`, and a second agent through `agents.create`. A local OpenAI-compatible
SSE service requested a real `read` tool call against a fixture workspace file,
then returned a deterministic assistant marker. Each session contained
`user → assistant/tool call → toolResult → assistant`. A synthetic provider key,
workspace marker, and custom skill were also seeded. The old runtime's
`chat.history` confirmed the actual stored history before upgrade; the histories
were not fabricated by editing JSONL records.

After the old app stopped, 8,064 files were copied into
`fixtures/upgrade-basic-golden/`, made read-only, and hashed. Two generated
plugin-skill junctions targeting packages inside the artifact root were recorded
instead of traversed or copied. The clone was **never launched**: its contents
include absolute references to the original live profile. Final checks confirmed
the golden files were still read-only and byte-identical.

The first seeding run completed its application work but its report serializer
rejected those normal junctions. The serializer was corrected to validate their
targets and skip traversal. A separate old-runtime verification run produced the
canonical baseline evidence, `old-verify-result.json`; no failed serialization
was counted as a successful check.

Reusable scripts retained in the artifact root after the restart-fix cleanup:

- `upgrade-validation-bootstrap.cjs`: package selection and isolation hooks.
- `run-upgrade-validation.mjs`: old seeding/verification, target upgrade, two
  subsequent starts, and concurrent new turns.

The one-off empty-profile baseline, inspection and summary scripts were removed
after their results were retained. The final restart runner is separate because
it does not replace this complete old-to-new migration validation.

## Startup and automatic migration

Times below run from the explicit manager start request to observed
`state=running` and `gatewayReady=true`; readiness polling adds up to roughly one
second. All timestamps are UTC. The subsequent-start rows are complete app
stop/start cycles on the same profile.

| Run | Start request | Observed ready | Elapsed |
| --- | --- | --- | ---: |
| Old package, empty profile | 10:20:26.514 | 10:20:36.634 | 10.120 s |
| Old package, seeded profile | 10:25:05.988 | 10:25:16.095 | 10.107 s |
| Target, first upgrade | 10:26:39.615 | 10:27:40.126 | 60.511 s |
| Target, subsequent start 1 | 10:28:12.479 | 10:28:57.887 | 45.408 s |
| Target, subsequent start 2 | 10:29:22.618 | 10:30:14.099 | 51.481 s |
| Target, concurrent-turn run | 10:30:50.047 | 10:31:34.435 | 44.388 s |

The first target child reported `audit-events-v2` schema migration required and
exited with code 78. The application's bounded startup recovery automatically ran
`doctor --fix --yes --non-interactive` once. Doctor ran from
`10:26:47.782` to `10:27:21.495` (33.713 seconds), completed successfully, and the
replacement Gateway became ready. No manual Doctor command, database repair, or
repeated launch was used to obtain this result. The later starts did not rerun
Doctor or repeat the schema migration.

The startup-recovery changes preserve this genuine migration repair path while
preventing ownership-contention errors from being mistaken for repairable
configuration failures. Lifecycle checks also prevent a stopped or superseded
start from beginning Doctor or another launch.

Evidence: `old-baseline-result.json`, `old-verify-result.json`,
`new-upgrade-result.json`, `new-restart1-result.json`,
`new-restart2-result.json`, and `new-live-result.json`. Complete application logs
are in `fixtures/upgrade-basic/userData/logs/clawx-2026-11-04.log`; each target
phase also has separate stdout/stderr logs. In `new-upgrade-stdout.log`, line 64
records snapshot creation, line 643 records Doctor success, and line 2052 records
the successful readiness RPC probe.

## Data, schema, backup and concurrent-turn results

Both agents (`main` and `upgrade-fixture-agent`) and both original sessions
remained available through real Gateway RPC. The old messages retained every
original field, including tool data and usage. The new history API added only
`__openclaw.transcriptPosition` metadata to those old messages; raw JSON equality
therefore differs while the original fields are unchanged.

Workspace and custom-skill markers and the ClawX device identity retained their
file hashes. The synthetic provider key was unchanged. The provider store's
`createdAt` and `updatedAt` account timestamps changed during synchronization;
all other provider-store fields matched. This report does not describe the
entire provider JSON file as byte-identical.

SQLite was inspected read-only after each app shutdown using
`PRAGMA integrity_check`, `PRAGMA foreign_key_check`, `user_version`, and recorded
schema/table inventories:

| Database | Old baseline | Target result |
| --- | --- | --- |
| Shared `state/openclaw.sqlite` | Version 1, 74 tables | Version 20, 106 tables |
| Main agent `agent/openclaw-agent.sqlite` | Absent; session history stored in legacy files | Version 25, 57 tables, migrated sessions/transcripts |
| Preserved snapshot's shared database | Version 1 | Still version 1 and intact |

All five SQLite files found in the final live profile, including the snapshot,
quarantine database and temporary plugin-capture database, returned
`integrity_check=ok` and zero foreign-key violations. These checks establish the
observed database consistency, not exhaustive application-schema correctness for
every untested feature.

The first target launch preserved
`home/.openclaw/backups/clawx-openclaw-2026.10.5-pre-migration/`. The creation log
reported 21 copied files; the post-stop directory manifest contained 24 files.
Its aggregate file-manifest SHA-256 remained identical after the first upgrade,
both later starts, and the concurrent-turn run:

`9395544e755dfbaaabf93f6f6ae574f1147ebf6f093df3b10233bbcb6e989de9`

Doctor also saved a separate `openclaw.sqlite.pre-startup-migration-*.bak`.
The target did not overwrite the original migration snapshot on later starts.

For the final live test, new turns were sent concurrently to both migrated
sessions. Four localhost model requests were observed: one tool request and one
post-tool completion per session. Both real `read` calls and final replies
completed in 5.038 seconds. Each history grew from four to eight messages while
retaining the old four-message prefix. A further 60-second observation included
16 successful RPC probes overall, with a maximum latency of 54 ms. Before and
after that observation, consecutive heartbeat misses and RPC failures were zero
and recovery state was `healthy`; the earlier pre-readiness RPC-failure timestamp
did not advance during the test.

Each run used manager stop followed by app quit. Final checks found no remaining
test Electron/Gateway processes or listeners on ports 28789/28790; the local
model server had also closed. Evidence is consolidated in
`upgrade-validation-summary.json`, with complete responses in `new-live-result.json`
and database/file inventories in `old-golden-inspection.json` and the
`new-*-inspection.json` artifacts.

## Controlled stale-owner identity experiment

`owner-identity-results.json` records a separate
isolated experiment against OpenClaw `2026.10.5`, Node `24.18.0`, Windows:

| Constructed ownership record | Observed result |
| --- | --- |
| Legacy record, no process start time, unrelated live PID, last renewal 415,345 seconds earlier | Blocked with `GatewayStateOwnerContentionError` in 713 ms |
| Live PID but recorded process start time mismatches | Ownership acquired in 9 ms |
| Legacy record referring to a process that has exited | Ownership acquired in 7 ms |

This demonstrates how a stale legacy record whose PID belongs to another live
process can produce the old-holder diagnostic. It supports PID reuse as a
plausible mechanism, but does not prove that the field report's PID 4324 was
reused, unrelated, or safe to terminate. That report did not contain sufficient
process-identity evidence. The experiment also does not reproduce the entire
field report's roughly 300-second ownership wait. No unverified holder was killed
and no real user lock or database was removed.

## Code corrections and automated validation

The Windows configuration cleanup previously recognized absolute plugin paths
using a leading `/`. It now uses native `isAbsolute` and `win32.isAbsolute` so
stale Windows drive/UNC paths are handled in legacy plugin arrays, `plugins.load`,
and `plugins.load.paths`, while relative paths and npm identifiers remain outside
filesystem cleanup. Coverage was added in `openclaw-auth.test.ts`; the tested
directory package included this fix.

The Node TypeScript project was unintentionally loading ambient Bun types from
installed dependencies. The recorded comparison had 75 diagnostics without a
type restriction and zero with Node types explicitly selected. Adding
`"types": ["node"]` to `tsconfig.node.json` corrected the target environment
without changing runtime code. Evidence:
`typecheck-bun-pollution-evidence.json` and `typecheck-after-fix.log`.

| Validation | Recorded result | Evidence under artifact root |
| --- | --- | --- |
| Upgrade/config/persistence focused unit selection, 16 files | 289 passed, 0 failed | `unit-upgrade-results-after-fix.json` |
| Parallel functional Electron E2E project | 199 passed, 3 skipped, 0 unexpected, 0 flaky | `parallel-e2e/results.json`, `parallel-e2e/console.log` |
| Node and web TypeScript checks after correction | Passed | `typecheck-after-fix.log` |
| Full ESLint check | 0 errors, 7 renderer fast-refresh warnings | `lint.log` |
| Full unit run | 2,897 passed, 70 failed, 6 skipped; 3 additional suite import failures | `full-unit-results.json`, `full-unit.log` |
| Focused recheck of runtime patch/fork risks | 14 passed, 2 failed | `full-unit-risk-recheck.json`, `full-unit-risk-recheck.log` |
| Actual communication replay and baseline comparison | Passed with temporary Windows URL-path workaround | `comms-replay-windows-workaround.log`, `comms-compare-windows-workaround.log`, `comms-compare-report.md` |
| Task validation against HEAD, task dry-run, harness CI | Passed; CI baseline 22/22 tests, with temporary LF normalization | `harness-validate-final.log`, `harness-dry-run-final.log`, `harness-ci-final.log` |

The full unit run is not green. Its CLI summary reports 20 failed files, 219
passed files and one skipped file. Seventeen failed files contain the 70 failed
assertions; three other files failed to import with `Invalid or unexpected token`:
`cua-driver-artifacts.test.ts`, `patch-nsis-extract.test.ts`, and
`patch-nsis-install-section.test.ts`. The import failures' causes remain unresolved.
The JSON reporter's nested-suite counts must not be substituted for file counts.

The following is a classification by affected area and observed symptom, not a
root-cause assignment or a declaration that failures predate this change:

| Area | Failed assertions | Observed evidence / unresolved question |
| --- | ---: | --- |
| Windows symlink privilege | 18 | Sixteen direct `symlink EPERM` failures and two callback failures while creating links; attachment access 8, workspace 4, issue export 2, skill cleanup 3, agent config 1 |
| Path and platform fixture assumptions | 39 | ACP service 4, ACP access registry 1, agent config 1, plugin installation 16, DingTalk CLI 7, OpenClaw CLI 8, host API 1, plugin compaction 1; includes separators, short Windows user paths and Linux mock paths |
| Utility-process file-URL fixture | 1 | String branch uses URL `pathname`, yielding invalid `/C:/...`; URL-object branch passes and `fileURLToPath` yields the valid path |
| CRLF assumptions | 10 | Nine harness spec frontmatter failures; one runtime patch raw-byte hash mismatch, with LF-normalized hash matching the lockfile |
| POSIX executable-bit fixture | 1 | After-pack test checks simulated macOS file permissions on Windows |
| Windows harness runner tooling | 1 | Unquoted Node executable path with `shell: true` reproduces `'C:\\Program' is not recognized`; remains unfixed |

No clean historical comparison was run to establish whether these failures are
pre-existing, regressions, platform-specific test defects, or product defects.
The successful upgrade and E2E results do not cancel these unresolved failures.

The Windows communication scripts exposed an additional validation-tool issue:
their entrypoint/root calculation used `new URL(import.meta.url).pathname`,
producing `/C:/...` paths. The ordinary `comms:replay` / `comms:compare` commands
exited zero without executing their main routines. Those no-op exits are **not**
counted as passes. Temporarily substituting `fileURLToPath` allowed the real
routines to run. Replay produced fresh metrics and comparison passed all hard
and relative thresholds (zero message loss/order violations and RPC timeouts).
Original script bytes were restored in `finally`; the tooling issue remains
unfixed in the repository. See the workaround logs and copied comparison report.

Harness task validation used `--since HEAD`, not `--no-diff`. Its dry-run selected
the required flow, and `harness:ci` passed with 22 baseline tests. Because the
existing frontmatter parser rejects CRLF, local spec files were temporarily
normalized to LF for these checks and their original bytes restored in `finally`.
This does not fix the parser or the separate runner path-quoting failure above.

## Remaining observations and coverage limits

Subsequent target starts remained about 44–51 seconds versus roughly 10 seconds
for the old fixture. In the final, quieter run, `process.bootstrap` alone took
35.131 seconds (`new-live-stderr.log`, line 20). This experiment did not establish
the underlying CPU, disk, dependency-loading or scheduling cause. Other automated
tests overlapped earlier runs, and no controlled performance benchmark or large
sample was performed.

One non-fatal `MaxListenersExceededWarning` reported 11 process `exit` listeners
during the concurrent-turn run (`new-live-stderr.log`, line 84). The run completed
and remained responsive; one warning is insufficient to establish a memory leak.
The field freeze was not reproduced in this small test.

This validation did not execute the installer or test Windows registration,
shortcuts, uninstall/rollback, or a real installed-app update transaction. It did
not validate real external AI providers, messaging channels, all ACP/UI delivery
paths, large historical datasets, extended uptime, or long-duration concurrent
load. It used real package initialization and Gateway behavior through a
purpose-built isolation bootstrap and Main-manager RPC, with a deterministic
localhost model. Those boundaries must remain explicit when using this report
for release decisions.

## 2026-11-05 follow-up: multi-Agent workspace and ownership consistency

Related task:
[Preserve 0.6.1 workspace consistency](../specs/tasks/fix-061-upgrade-workspace-consistency.md).
Workspace reproduction and package artifacts are retained separately under
`D:/ClawX-workspace-upgrade-review-20261105/`. This follow-up does not replace
the earlier fixture's provenance or extend its pass result to untested settings.

The confirmed workspace regression occurs when ClawX converts a legacy
`agents.list` roster and retires its default marker before the runtime can
preserve the old effective directory. An implicit legacy default workspace
can then resolve to a different directory under the current multi-Agent
ownership rules. Existing files can remain intact while the Agent and UI use a
new empty directory; preserved hashes and Gateway readiness alone do not rule
out this regression.

The repair pins an implicit workspace only when the roster transition would
change its effective path. It preserves explicit workspace paths, including
external directories, without moving or merging their files. The same comparison
applies to current Agent creation, update and deletion so a later mutation cannot
move another Agent's inherited workspace. Agent snapshots and workspace
identity/bootstrap maintenance read the canonical keyed roster first and share
the current runtime's path rules. Already-current configurations are not
reinterpreted as historical ownership based on directory existence.

Retiring a unique true default marker in a valid legacy multi-Agent roster also
materializes the pinned runtime's existing responsibilities: missing
channel-wide wildcard fallbacks, heartbeat, systemAgent, authInheritance,
fixed sessionStore and talk. Scoped bindings remain in place; disabled channels,
explicit owners, disabled role settings, existing heartbeat policy and per-agent
session-store paths are preserved. An unmarked first Agent only receives a
workspace pin when needed, not invented runtime roles. Malformed or ambiguous
rosters remain for Doctor. The existing systemAgent selection is retained for
unmarked rosters; no additional heartbeat or talk role is invented for them.

Deletion refuses the sole configured Agent and explicit inherited-auth or
session-store owners. Managed workspace cleanup resolves directory links and
keeps a directory that overlaps another surviving Agent's workspace.

A separate migrated-session defect was reproduced against the bundled v25
schema and runtime entry parser: offline rename changed indexed `label` and
`updated_at` while leaving `entry_json` stale, so the runtime rejected the row.
The repair validates existing source/projection consistency and updates the
logical entry and indexed metadata in the same transaction. It retains unrelated
entry fields and refuses inconsistent rows without mutation or schema changes.

Focused evidence available during implementation:

- Legacy role regression suite: 12 tests passed; the helper also matched the
  actual OpenClaw 2026.10.5 `materializeLegacyDefaultAgentRoles` result for 64
  synthetic combinations of old owner, heartbeat, fixed/per-agent store and
  explicit role settings.
- Session workspace/persistence suite: 17 tests passed, including offline rename
  source/projection consistency and refusal of damaged metadata. The actual
  bundled runtime parser accepted the corrected entry.
- Complete migration differential: 70 synthetic configurations and 126 Agent
  paths matched the official 0.6.1 and current runtime resolvers before/after
  migration. The run also checked role materialization, source preservation
  and idempotence. The shared path helper separately matched 2,208 old/current
  runtime resolver comparisons.
- Combined focused regression: 8 suites, 276 tests passed. TypeScript and full
  repository lint passed (7 existing React Fast Refresh warnings). Harness task
  validation/dry-run, harness CI and communication replay/compare passed. The
  existing Windows harness newline and comms URL workarounds were temporary;
  all transformed source files were restored byte-for-byte.
- All 3 focused Electron E2E cases passed: legacy workspace preservation during
  Agent creation, inherited SQLite credentials, and preserving a shared workspace
  when another Agent is deleted. Three existing exclusive prerequisite tests
  also passed in the initial E2E run.

The repaired package was then tested against a fresh official 0.6.1 profile,
with three real Agents, three ACP-bound workspaces, a local deterministic model
and old assistant replies. Upgrade and a subsequent target restart both passed:
the old runtime, new runtime and Main Agent snapshots reported identical paths
for main, research and coder. All three histories and cwd ledger entries loaded;
workspace selection, recent paths, labels and marker-file hashes were retained.
This includes an implicit main workspace, an external Chinese path with spaces,
and a second external workspace. Test apps closed and both owned ports were
released after every phase.

The target is a local directory build of `codex/fix-061-upgrade-workspace` on
base commit `44a43113eee9901f0070ff2fee864509d56ba51b`, with app version 0.6.2
and OpenClaw 2026.10.5; it is not the published v0.6.2 release. Its `app.asar`
SHA-256 is `3c92d6e70ea8bed75fcfeb39939df457e50c43874e8dc8a721bb4beb9849d623`.
The packaged Main entry exactly matched the current compiled Main entry
(`b0d808bb961386741028442d0b4f2999958b6ea664ddf67d4d1a28b771c47f1a`).
Gateway ready time in this one fixture was 8.2 s on old 0.6.1, 64.7 s on first
upgrade and 19.4 s on the subsequent target launch. These are observations,
not a performance benchmark or a startup-speed guarantee.

Evidence: `D:/ClawX-workspace-upgrade-fix-verified-20261105/`, especially
`verified-upgrade-summary.json`, `migration-resolver-parity.json`, the phase
results, and validation logs. An initial test-bootstrap attempt rejected its
copied isolation root before app initialization; it was retained separately at
`D:/ClawX-workspace-upgrade-fix-20261105/` and is not counted as an app result.

### Confirmed remaining compatibility boundaries

The following findings are **not repaired by the workspace/ownership change**:

- Configurations already converted by an affected version cannot reliably be
  identified from keyed entries alone. This repair does not guess and move their
  current workspace; recovering their original path requires comparing the old
  config/snapshot with their actual data.

- Feishu advanced group policy: the old `openclaw-lark` plugin can interpret
  non-`oc_*` entries in `groupAllowFrom` as sender restrictions. The current
  migration does not move that meaning to `groupSenderAllowFrom`. With an
  explicitly configured group, the real new ingress functions selected an open
  sender gate where the old plugin selected an allowlist. Both schemas accepted
  the fixture, so schema validation alone misses this access-policy regression.
- Feishu old field types: old-valid boolean `replyInThread`, string
  `allowFrom`, and object `capabilities` remain incompatible with the new
  schema. The current migration and real new Doctor contract did not convert
  these fixture fields.
- Feishu dictionary entries: the schema-pruning helper does not recurse into
  `additionalProperties` maps, leaving old group fields such as `groupPolicy`
  and `respondToMentionAll` that the new strict schema rejects. A future repair
  must translate access semantics before pruning; deleting policy fields alone
  can broaden access.
- Failed plugin mirror replacement: the install-record repair chooses the new
  Feishu/QQ plugin ID even when the actual retained payload still has the old
  manifest ID. A read-only probe of the current repair functions captured
  deletion of the old index IDs and insertion of the new IDs pointing to the
  old payload. This proves metadata inconsistency after copy failure, not that
  every such failure prevents the entire Gateway from starting.
- Custom `agents.entries.<id>.agentDir`: the runtime respects the configured
  auth directory, while ClawX's auth SQLite helper still assumes the standard
  agent directory. UI credential reads/writes/deletions can target another
  database; this is a pre-existing path assumption, not a newly established
  workspace-migration regression.
- Custom `session.store`: the runtime supports both fixed paths and
  `{agentId}` templates, but some ClawX offline transcript, session mutation and
  usage paths still assume the standard agent database. Those views or fallback
  operations can miss the configured store. Preserving the fixed store's owner
  does not add custom-path support to these consumers. The old JSON readers
  already had the path assumption; ordinary custom workspaces alone do not
  trigger either this issue or the custom-auth-directory issue.
- Installer coverage remains separate: the official old installer was extracted,
  and target tests use a directory package with isolated profile paths. They do
  not exercise installation over an existing Windows installation, a changed
  installation/data directory, registry/shortcut ownership, uninstall, or rollback.
  No installer-directory compatibility pass is claimed.

Safe Feishu schema/policy evidence is in
`D:/ClawX-channel-upgrade-review-20261105/results/feishu-policy-review.json`;
the probe uses synthetic credentials and no channel network operations. QQ's
restriction on selecting a named default while a root default account exists is
an explicitly documented Tencent 2.0 compatibility constraint. Cleanup of
disabled channels as unconfigured predates this kernel upgrade; neither should
be presented as a newly discovered regression from this workspace repair.

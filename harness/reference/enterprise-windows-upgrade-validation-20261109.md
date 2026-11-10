# Enterprise Windows upgrade validation, 2026-11-09

Task: `harness/specs/tasks/validate-enterprise-windows-upgrade.md`.
Community baseline: [Windows SQLite upgrade validation](windows-sqlite-upgrade-validation-20261109.md).
Private local artifacts are under `test-results/windows-upgrade-20261109/`;
enterprise evidence uses its `enterprise/` subdirectory and isolated app state
uses `profiles/`.

The user requested both 0.6.1 and main enterprise upgrade routes, retaining
the requirement not to operate the installed ClawX. Real enterprise gateway
login was explicitly excluded by the user; any local synthetic authentication
checks must be labeled separately.

## Provenance

The local Biz repository is at `642a185` on its main branch, with both its
recorded and checked-out ClawX submodule at `ba5d1d4d` (community 0.6.1,
OpenClaw 2026.7.1-2). This is not a community-main runtime baseline. The main
enterprise baseline explicitly assembles community `6be7ae2c`; the original
enterprise target uses the SQLite-repaired community commit `23778449`.

The downloaded `ClawX-latest-win-x64 (1).exe` was identified by its extracted
application metadata as enterprise `0.6.1-biz.1`, OpenClaw `2026.7.1-2`.
Its SHA-256 is `98a268a419f0d1c812cde47c995c8039b503f33fb884ef9d88698943ec816ae1`.
Extraction did not execute the installer or app.

The main baseline and original enterprise target use Biz `642a185`, version
`0.6.2-biz.0`:

| Package | Community | OpenClaw | Electron | Verified files |
| --- | --- | --- | --- | ---: |
| main baseline | `6be7ae2c` | 2026.10.5 | 41.10.7 | 501 |
| original enterprise target | `23778449` | 2026.10.10 | 41.10.7 | 512 |

Target verification includes all eleven corrected SQLite runtime files.
Both assemblies pass separate Main and renderer TypeScript checks. The Biz
combined TypeScript configuration reports the same pre-existing Node/DOM
`ReadableStream` cast diagnostic in `acp-chat-service.ts:831` on both versions.
No release installer was executed and no installed application was operated.

## Isolated fixtures

Enterprise routes use separate profiles and ports: 0.6.1 at 30789–30791 and
main at 31789–31791 (Gateway, local model, local authentication/SkillsHub).
The actual packaged Main/renderer/Gateway run through the previously validated
isolated launchers. Runtime E2E stubs are disabled. All home, application data,
state, session, temporary and crash paths point into the task directory.

The local authentication service returns synthetic credentials and policy.
Model requests must present the exact synthetic API key, and encrypted tokens
must decrypt correctly through Windows Electron safeStorage. Fixtures include
two agents, separate Chinese workspace paths, two old histories and model
preferences. Normal enterprise teardown may clear derived runtime projections
but must preserve encrypted session state.

Authorized enterprise channel coverage uses WeCom and DingTalk. QQ and Feishu
are excluded by enterprise packaging. WeChat, external message delivery, real
enterprise authentication, external SkillsHub and EWS delivery are untested.

## Baseline validation

The official 0.6.1-biz.1 seed passed: two model round trips, enterprise host
contributions and policies, local SkillsHub search, encrypted credentials,
both workspaces, both channel connections and three offline integrity checks.
Agent and shared SQLite schema metadata are version 1 in this old package.

The main seed also passed the same enterprise, two-agent conversation, channel,
workspace and integrity checks. Its final agent schemas are 25 and shared schema
20. Fresh initialization first hit `no such table: device_identities`: the old
DingTalk installer wrote a partial shared-store plugin index before Gateway
identity bootstrap. Automatic Doctor completed in 262.227 seconds, then Gateway
recovered, enterprise login completed and its scheduled restart succeeded.
This is old-baseline initialization time, not target-upgrade time.

## Original enterprise target results

Both original enterprise targets failed enterprise runtime projection ordering.
Results are preserved in `enterprise/initial-target-results/061-enterprise.json`
and `enterprise/initial-target-results/main-enterprise.json`, independently of
subsequent checkpoint restores.

| Route | Full Gateway readiness after initialization | Final agent / shared schemas | Result |
| --- | ---: | --- | --- |
| official 0.6.1-biz.1 → original target | 124.800 s | 27 / 22 | Failed: SkillsHub runtime projection absent |
| main enterprise → original target | 466.746 s | 27 / 22 | Failed: SkillsHub runtime projection absent |

In both routes, both agents retained their old histories and completed new
model calls. Channel connections, workspace markers, encrypted tokens and all
three offline SQLite integrity checks passed. Nevertheless, enterprise restore
ran before native migration was admitted: the 0.6.1 route logged
`OpenClawAgentSchemaMigrationPendingError` against schema 1, and both results
recorded one `runtimeProjectionFailed` followed by an announced token restore.
After migration, `skillsHubProjected` was the only failed online enterprise
check. Successful local SkillsHub host search does not prove that its Gateway
runtime configuration was projected. Database and chat success therefore do
not make either original enterprise upgrade a pass.

Main's Doctor ran from 10:52:36.944Z to repair success at 10:59:37.165Z,
approximately 420.221 seconds. This is part of the 466.746-second target
readiness measurement, separate from the old-baseline initialization above.
The intermediate Codex package-convergence warnings settled in this same pass:
the official external plugin advanced from 2026.10.5 to 2026.10.10, deferred
state migration completed at 10:57:38.804Z, and Doctor completed successfully.
Codex was retained; its warnings were not the final enterprise failure.
Evidence is summarized in `enterprise/main-codex-convergence-analysis.txt`.

The first main-target attempt was interrupted by the fixture's one-minute
application-initialization limit while the pre-upgrade snapshot was still being
created. A second attempt hit a recoverable Playwright evaluation-context
failure. Neither had initialized enterprise contributions, so neither is proof
of an enterprise-extension defect. The runner now allows ten minutes for
initialization and retries only read-only context evaluations, never login or
message submission. The completed main result in the table supersedes those
interrupted harness attempts.

## Startup-order repair validation

The repair is tracked by
`harness/specs/tasks/fix-enterprise-runtime-migration-order.md`. It separates
encrypted session restoration from runtime projection. Managed Gateway startup
must capture the upgrade backup, check native-store readiness, complete any
required Doctor migration, await enterprise projection, and only then spawn
the Gateway. Normal application exit must await extension cleanup within the
existing bounded quit flow.

The first fixed candidate remains `0.6.2-biz.0` / OpenClaw `2026.10.10` and
contains the captured community and Biz working-tree changes. Package evidence
records 50,204 successful file checks and zero failures; separate packaged Main
and renderer typechecks passed. Its `app.asar` SHA-256 is
`fa2f35940ea735e0951f8815f0f03bbaa6e8e974eebfc8f1e5cdc60855e690f2`.
Source, build and package provenance are recorded in
`enterprise/target-fixed-source-provenance.json`,
`enterprise/target-fixed-build-validation.json` and
`enterprise/target-fixed-package-verification.json`.

The first fixed candidate (v1) passed every online enterprise assertion on both
routes, including SkillsHub projection. Each recorded one completed runtime
projection and no projection failure, retained both agents' old histories,
completed two new model requests and retained both workspace markers. All three
encrypted session fields decrypted to the expected synthetic values and remained
present with unchanged ciphertext hashes after exit. Both routes nevertheless
failed the stricter normal-exit cleanup assertion: router configuration, each
agent's canonical auth profile and model projection remained, while SkillsHub
configuration was removed.

| v1 route | Run start → Gateway start | Full readiness after app initialization | Doctor | Normal app exit | Overall result |
| --- | ---: | ---: | ---: | ---: | --- |
| 0.6.1 enterprise | 107.580 s | 84.025 s | 54.376 s | 747 ms, code 0 | Failed exit cleanup |
| main enterprise | 130.232 s | 492.568 s | 449.262 s | 742 ms, code 0 | Failed exit cleanup; channel connections unverified |

Readiness excludes the earlier application-initialization window. The first
duration includes fixture launch, application initialization and pre-upgrade
backup; it is not an isolated Electron-startup benchmark. Main's Doctor ran
11:40:22.270Z–11:47:51.532Z; the subsequent enterprise projection completed
before Gateway spawn. Both v1 runs used restored checkpoints, so native-plugin
recapture and the initial-profile runs are different timing conditions.

The 0.6.1 route connected both channels. Main retained all four channel
credential fields exactly, but did not establish verified connections within
the helper's 120-second deadline (37 observations). WeCom reported running and
a successful probe, with repeated WebSocket TLS failures and no authenticated
log. DingTalk repeatedly failed its Stream TLS connection; its final state was
not running, with no last-connected timestamp and an HTTP 403 probe error.
There was no earlier positive connection evidence for either channel. This is
an additional observed connection failure, not evidence of credential loss or
a proven SQLite cause; a later isolated retry must resolve it.

Sanitized aggregate evidence is in
`enterprise/fixed-v1-validation-summary.json`; individual results are
preserved as `enterprise/target-fixed-v1-preserved/061-enterprise-upgrade-fixed-result.json`
and `enterprise/target-fixed-v1-preserved/main-enterprise-upgrade-fixed-result.json`.
The v1 runner stopped at
the cleanup assertion before collecting its final offline integrity checks;
neither result can claim those checks passed, and no restart run followed the
failed upgrade. These results demonstrate repaired startup projection ordering,
not complete upgrade passes. The v2 exit-cleanup candidate subsequently passed
both fresh-C upgrade routes and their subsequent restarts, as recorded below.

The exit follow-up orders ACP stop, Gateway stop and awaited extension cleanup
within the existing 30-second total deadline; Computer Use cleanup remains
parallel. Enterprise session and restart guards reject late work as soon as
application quit begins. Gateway guards also cancel queued recovery and a
restart already waiting for stop, preventing a new process during quit.
Tests retain the external-attachment boundary:
if startup preparation never admitted native writes, teardown leaves native
auth and image state untouched. The Biz follow-up passed 214 tests in 31 files
and typecheck; the final v2 community validation selection passed 102 tests in
six files. Packaged exit validation is recorded separately below.

The v2 package changes only `resources/app.asar`, with SHA-256
`f791a7a988f267b0152dddcedb40a5c7afb320553ce401e8f28345ddd53d6a37`.
Its incremental verification passed 6,072 checks, plus packaged Main/renderer
typechecks and the Vite build. Changed archive contents, retained production
dependencies and the eleven SQLite fixes were checked; unchanged resources
retain v1's full-package provenance rather than a claimed second full rehash.
Evidence is in `enterprise/target-fixed-v2-package-verification.json`.

The final enterprise installer is
`enterprise/installer-final-v2/ClawX-0.6.2-biz.0-win-x64.exe`, 399,405,876 bytes,
SHA-256 `69597bedaee3528cc5ee07afbdb93d9f5593b780da5ab63eb4c3d89f8aab26aa`.
Its extracted `app.asar` matches the tested v2 hash above, and all eleven repaired
runtime files match: twelve extracted hashes passed. The complete source payload
inventory and hashes remain unchanged across 49,670 files. Executable version
metadata and `biz.yml` size/SHA-512 checks passed; Authenticode reports
`NotSigned`. The completed report is
`enterprise/installer-final-v2/verification.json`; the task-wide
`final-installers-ready.json` records both editions and no remaining task
processes or test listeners at completion.

Packaging retained the frozen NSIS templates and used electron-builder 26.16.0's
existing `UninstallerReader` to extract the intermediate uninstaller without
executing it. The first post-build verifier expected a nested
`$PLUGINSDIR/app-64.7z`; its failed extraction log remains preserved. The final
independent verifier used 7-Zip's observed direct embedded-7z view at offset
635,330. Although the configuration requested `compression=normal`, the actual
embedded archive used `-mx=9`; no compression speedup is claimed. Signing and
publishing were disabled. No installer or packaged app was executed by these
packaging/verification helpers. NSIS registration, active-installation overwrite
and uninstall remain untested, as does real enterprise authentication.

## Fresh private-C v2 results

Both the official 0.6.1-biz.1 and main enterprise routes passed their fresh seed,
target upgrade and subsequent restart using the same v2 package. C: results are under
`C:/Users/70954/windows-upgrade-20261109-isolated/profiles/`.

| Route and phase | Full readiness after initialization | Whole fixture run | New model requests | Normal target-app exit | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 0.6.1 old-package seed | 37.192 s | 88.753 s | 2 | Seed preparation only | Passed |
| 0.6.1 `upgrade-private-v2` | 90.759 s | 159.915 s | 2 | 554 ms, code 0 | Passed |
| 0.6.1 `upgrade-private-v2-restart` | 41.451 s | 49.359 s | 0; existing histories checked | 491 ms, code 0 | Passed |
| main old-package seed | 163.932 s | 263.121 s | 2 | Seed preparation only | Passed |
| main `upgrade-private-v2` | 71.844 s | 114.763 s | 2 | 1,263 ms, code 0 | Passed |
| main `upgrade-private-v2-restart` | 38.754 s | 47.188 s | 0; existing histories checked | 495 ms, code 0 | Passed |

Readiness starts after application initialization. Whole-run durations include
initialization, any backup, chat/channel validation, exit and final checks; they
are not application-launch latency measurements.

All four target phases passed all online enterprise assertions, both channels'
verified connection checks, exact channel credential retention and both
workspace markers. Both agents retained the seed histories; each restart also
retained the new upgrade replies. Each target launch logged exactly one completed
enterprise projection with no projection failure. All three encrypted session
fields decrypted to the expected local-fixture values, remained present and were
byte-identical across each normal target exit. Every model request used the
expected synthetic API key; there were no unauthorized model requests.
Each exit removed the router configuration, SkillsHub configuration, canonical
enterprise auth profiles and agent model projections. This validates restore
from retained encrypted state after a successfully cleaned normal exit.

Three offline integrity checks returned `ok` after each target exit. Both agent
schemas advanced from 1 to 27 on the 0.6.1 route and from 25 to 27 on main. The
shared schemas advanced from 1 and 20 respectively to 22, with correct
agent/global ownership. Both current agents record producer `2026.10.10`.
The shared `app_version` is null on the 0.6.1 route and remains `2026.10.5` on
main, as permitted by the upstream schema writer. Shared producer metadata is
diagnostic, not a required migration-success condition. No database value was
changed to satisfy a test.

| Native Doctor evidence | 0.6.1 route | Main route |
| --- | --- | --- |
| Invocation → repair success, UTC | 12:31:56.889–12:32:59.900 | 13:08:05.867–13:08:52.752 |
| Doctor duration | 63.011 s | 46.885 s |
| Original-state capture success, UTC | 12:32:13.421 | 13:08:18.539 |
| Three repair-specific SQLite backups, UTC | 12:32:14.556 | 13:08:19.766 |
| Sealed capture payloads | 4 files; 1,316,244 bytes | 4 files; 3,213,034 bytes |
| Captured shared / main / ops schema versions | 1 / 1 / 1 | 20 / 25 / 25 |

The final hardened read-only capture verifier exited 0 on both routes with
`verified=true` and `fullCoverage=true`. Each schema-2 baseline manifest has
matching payload sizes and SHA-256 values, all three captured SQLite headers
match the old seed, all three repair-specific backups exist, and there are no
resource warnings or exclusions. It also rejects malformed or conflicting
resource inventories and binds parsing and hashing to the same manifest bytes.
Final direct verifier outputs are preserved under the C: task's `enterprise/`
directory as `061-enterprise-native-original-capture-verification-v2.json` and
`main-enterprise-native-original-capture-verification-v2.json`.

Main's initial pipeline stopped at `backup-seed-ready`, before target launch:
.NET reordered seven inherited Allow ACEs while applying the DACL to the
checkpoint copy. Its failed `enterprise/main-enterprise-private-v2-summary.json`
is preserved unchanged. A narrowly guarded Win32 DACL-only fallback restored
the original ACE order on the pending copy; owner, source profile and access
rights were unchanged. The strict comparator still ignores only the `AI`
completion bit. Two actual Windows file/directory regression cases passed.
The resumed backup sealed 17,209 files, 26 links and 17,917 ACL records with
zero effective differences. The successful main upgrade and restart in the
table are a separate manually resumed execution, not a rewritten success for
the failed pipeline. Provenance is retained in
`enterprise/checkpoint-dacl-repair-provenance.json`,
`enterprise/main-pending-dacl-repair.json` and
`enterprise/main-private-v2-resume-backup.log` under the C: task directory.
The 0.6.1 full task checkpoint separately retained 8,738 files and 9,226 DACL records.

The sanitized aggregate is
`enterprise/fresh-private-c-validation-summary.json` under the D: task artifacts.
It independently requires phase-appropriate schemas, all three integrity
checks, histories, workspaces, credentials, enterprise projection, both channel
connections, normal target-exit cleanup and verified native captures. Its final
`overallVerified` is true; it preserves the initial main pipeline failure and
manual continuation separately.

This confirms retained capture integrity, not a successful restoration exercise.
No full-profile or native original-capture restore was performed. The native
capture verifier and its criteria are preserved in
`enterprise/verify-native-original-capture.mjs` and
`enterprise/native-original-capture-verification.txt` under the D: task artifacts.
Here `fullCoverage` describes the task's required capture resources and payload
checks, not the complete upstream restore-authorization parser. Real enterprise
authentication and external SkillsHub remain excluded; local fixture
authentication and policy/session persistence were exercised.

## Checkpoint fidelity and performance scope

The D: fixtures have an explicit native-backup limitation. Doctor could not
create its standalone original-state capture because the isolated home and its
ancestors inherited effective Authenticated Users modification rights. The
native policy checks every ancestor through the drive root; protecting only the
fixture home would leave the next ancestor unsafe. This was a successful ACL
read followed by policy refusal, not a PowerShell `Get-Acl` or `PSModulePath`
failure. No Windows permission checks were bypassed.

On main v1, the warning appeared 102.512 seconds after Doctor invocation. Plugin
resource inventory and traversal precede the repository ACL admission, so this
gap is not a measurement of ACL-check execution time. The refusal occurred
before per-run capture payload creation and manifest sealing. Standalone Doctor
explicitly continued, taking its repair-specific SQLite backups; it did not
complete the full native original-state capture. The independently verified
task checkpoints described below remain available, but are a separate recovery
mechanism. See `enterprise/doctor-original-capture-acl-analysis.txt` for source
locations and the sanitized evidence.

Full validation was repeated with fresh old-version seeds under a newly
created, private task directory directly beneath the Windows user home on C:.
Only that new directory and its descendants may receive fixture ACL changes;
existing home, workspace and volume ACLs remain untouched. These are new
fixtures with new provenance. D: DPAPI stores, checkpoints and timing results
must not be relabeled as C: evidence. Successful native original-state capture
was an explicit requirement and passed for both fresh routes.

The fresh C: setup was independently reviewed: its protected root grants only
the current user, SYSTEM and Administrators full control, inherited by the
empty profile directories and copied credential file. Six noncredential script
hashes match the setup receipt. Checkpoints may preserve links into exactly
three verified D: application packages, without traversing those targets;
copy, restore and ACL mutation destinations remain inside the C: fixture.
The root dependency junction is outside `profiles/`.

Both fresh seeds explicitly select a local bootstrap model without an API key
before their first Gateway start; normal old-enterprise login supplies and
projects the synthetic credentials before any chat. No SQL or deletion-journal
rows are seeded by the harness. This declared fixture strategy avoids default
Codex installation and is not timing-comparable to the D: default-model seed.
The C: `setup-receipt.json` and each result's `fixtureBaseline` preserve that
distinction. Real enterprise authentication remains excluded.

Full baseline checkpoints are verified byte-for-byte, preserve Windows DACLs
and absolute in-task junctions, and retain the opaque DPAPI token store. DACL
comparison ignores only Windows' automatic-inheritance completion bit (`AI`),
preserving protection/request flags and all access-control entries. Main's
baseline has no pending agent deletion, held-agent recovery or incomplete import.
Restoring a clean checkpoint to the same path does not require SQLite identity
rebinding. Plugin native capture identities may require recapture on a clone,
so repeat timings must identify restored-clone runs separately.

The earlier D: main checkpoint contains about 1744.55 MiB of logical native-capture bytes,
including four Codex native payload captures totaling 1718.98 MiB. Its Codex
npm project adds 447.37 MiB. These are not SkillsHub payloads (about 0.36 MiB).
Original captures may share hardlinks; logical bytes do not prove physical disk
use. Installed-index receipts can reference committed native captures, so they
must not be discarded merely because their path contains `tmp`.

An initial main seed that logged in
before its first Gateway startup reproduced the old missing-deletion-journal
hold; the retained failed fixture is separate from the intended healthy baseline.
The accepted fresh seed initialized the Gateway before login, matching the normal
auto-start-before-login flow without manually editing databases or journals.

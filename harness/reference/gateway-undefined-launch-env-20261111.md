# Gateway environment conversion failure, 2026-11-11

Task: `harness/specs/tasks/fix-gateway-undefined-launch-env.md`.

## Report evidence

Source: the user-supplied issue report ending `20261111-055407Z.zip`,
`logs/clawx/clawx-2026-11-11.log`. Times below are Asia/Shanghai (UTC+8).
The reported application identifies as `0.7.0-biz.0`, Windows x64,
Electron 41.10.7 / embedded Node 24.18.0. No build commit or complete process
environment is included, so exact installed-source provenance is unavailable.

| Time | Evidence |
| --- | --- |
| 09:12:27 | SkillsHub cannot load because its `tar` dependency is missing. |
| 09:12:31 | Gateway nevertheless connects successfully, after about 133 seconds. |
| 11:59:21 | A later app launch starts automatic Doctor repair. |
| 12:03:36 | Doctor reports agent schema migration from v25 to v27. |
| 12:06:43 | Doctor exits 1 after reporting SkillsHub load errors; ClawX correctly proceeds to retry Gateway startup. |
| 12:06:45 | Electron throws `TypeError: Invalid value for env` in `ForkUtilityProcess`, before a PID exists. |
| 12:10:16 | All ten automatic reconnection attempts have failed with the same error. |
| 13:53:20 | Restarting the app produces the same pre-spawn failure. |

The Doctor capture worker also timed out, and the codex plugin reported an
unfinished data/settings upgrade. Those diagnostics are separate from the
subsequent Electron constructor failure; this fix does not establish that the
customer's complete runtime state or plugins are healthy.

## Reproduction and fix

Community commit `ca215035c` added an unconditional
`CLAWX_CRON_MIGRATION_MANIFEST: cronMigrationManifest` to the Gateway launch
environment. Migration preparation legitimately returns no manifest when
there are no eligible tasks, and extension continuity can also be empty.
The resulting property has value `undefined`.

The shared utility-process helper passed this object directly into Electron.
Node's `ProcessEnv` type allows undefined entries, but Electron rejects them
while converting the environment to its native string map. See the
[Electron 41.10.7 constructor](https://github.com/electron/electron/blob/v41.10.7/shell/browser/api/electron_api_utility_process.cc#L441-L443).
The isolated native reproduction produces the same stack and error as the
report. This establishes a matching code defect, though the report itself
does not record the offending environment key.

The Gateway environment builder now omits `CLAWX_CRON_MIGRATION_MANIFEST`
entirely when no current manifest exists, and removes any stale inherited value.
Only a current nonempty path is injected. The native regression asserts that
the property is already absent before the utility-process wrapper is called.

As a fallback, `forkOpenClawUtilityProcess` removes undefined entries from its
own copy before invoking Electron. It preserves all defined values, including empty
proxy overrides and paths with spaces/non-ASCII characters. Explicitly unset
values do not fall back to stale parent values. Caller environments, debug
settings and private Gateway shutdown control retain their existing semantics.
Other invalid value types still fail instead of being silently stringified.

## Validation and deployment scope

The real Electron Playwright regression uses synthetic child code and isolated
app data. Before the fix, the absent-manifest launch throws the reported error.
After the fix, both absent and present manifests start and finish successfully;
the tests also check stale inherited manifests and cleared inherited proxies.
The 42 targeted unit tests cover config environment construction,
utility-process compatibility, Gateway launching and cron continuity. They
check that undefined or empty manifests produce no own property before launch,
while a current path replaces stale inherited evidence without changing the
parent. The eight parallel-isolation checks, 23 harness CI tests, full
Main/renderer typecheck and ESLint on changed TypeScript files also pass.
The task spec and selected harness dry-run validate against `origin/main`,
including working-tree and untracked diff checks.

Both required comms package commands were invoked, but their existing Windows
file-URL pathname check skipped execution and left an old report untouched.
The same exported replay/compare functions were then run in memory with their
module filenames converted to actual Windows paths; the fresh report at
`artifacts/comms/compare-report.md` passes every baseline threshold. No comms
script or baseline was changed for this startup fix.

This validates the native process-launch boundary, not a complete enterprise
login, SkillsHub installation or customer-profile upgrade. The customer's
configuration and databases were not executed or modified. Enterprise builds
must incorporate the community fix and rebuild before delivery. SkillsHub's
missing dependency requires a separate plugin packaging/installation repair;
repeated Doctor runs cannot fix this JavaScript-to-Electron env conversion.

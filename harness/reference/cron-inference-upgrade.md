# Scheduled-task inference continuity across upgrades

The 2026-11-10 drink-water incident exposed a gap in upgrade coverage. The old
task completed with the enterprise model before migration, then failed after
Doctor and credential restoration with `Automation has no recorded inference
account`. Its retained definition had no `inferenceBinding`; a newly created
task captured an account and succeeded. This establishes missing legacy account
attribution, not a missing model catalog or proof that Doctor deleted a binding.
Earlier chat-only upgrade probes do not establish scheduled-task compatibility.

## Migration contract

ClawX verifies the pre-migration snapshot and identifies eligible old task,
model and profile evidence. Community and enterprise credential projections
complete before scheduled dispatch. The native runtime captures a
current authorization and conditionally updates only the missing binding.
Task IDs, history, enabled state, schedule, message, delivery and inherited
model selection remain unchanged. System jobs, existing bindings and runtime
authorities remain authoritative. Missing or ambiguous evidence, changed
credentials, deletion and concurrent task edits must not pick another owner.
Repeated startup is idempotent; external Gateway attachment is excluded.

Remote model removal follows the configured fallback chain within the bound
provider and account, including when the task explicitly preferred the removed
model. The runtime preserves the task's model declaration and inherited defaults.
Explicit model locks, an explicitly empty fallback list and model policy denials
remain authoritative; fallback must not silently select another account.

The ordering guarantee covers scheduled dispatch. Gateway `/readyz` and manual
`cron.run` may be available while asynchronous scheduler initialization is still
in progress. A readiness response alone is not proof that binding recovery has
completed; isolated probes must observe the repaired binding before forcing a
manual run. This change does not claim to remove that manual-start race.

Canonical credential stores also contain `authorizationLifetimes`. Shared and
per-agent writers reconcile raw stored metadata through the native writer inside
the transaction. Identical credentials preserve authorization; replacement or
deletion revokes it. Incoming JSON cannot claim trusted lifetime continuity.

## Enterprise projection cleanup

ClawX-biz removes plaintext runtime credentials on normal quit while retaining
its encrypted login session. Before removal, after Gateway shutdown, the
extension captures only tasks whose existing binding is still valid according
to native authorization. A safeStorage-encrypted receipt is scoped to the same
user, authentication endpoint, provider endpoint and API key. On startup,
credentials are restored first and the host buffers matching continuation
entries until every startup preparation succeeds. Native task updates compare
the expected old definition and binding before replacement.

Fresh login, logout, expiry and account changes cannot reuse that receipt.
Failed capture still removes plaintext secrets and leaves diagnostics. Evidence
does not use the token store's plaintext encryption fallback. Remote catalog or
access-token refresh does not by itself change account identity; runtime model
selection and fallback remain separate from account authorization.

## Validation boundaries

The task specification is
[`preserve-cron-inference-on-upgrade`](../specs/tasks/preserve-cron-inference-on-upgrade.md).
Unit evidence must cover community and synthetic enterprise credentials; shared
and per-agent stores; explicit and inherited models; disabled jobs; stable
task definitions/history; repeated startup; revoked and replaced accounts;
concurrent edits; and enterprise quit/restore, cancellation and login boundaries.
Native Gateway execution against a local synthetic inference endpoint is a
separate validation layer from fixture tests. Real enterprise authentication,
customer state and installed application upgrades are not proved by synthetic
tests. Actual commands and results are recorded below.

## Validation on 2026-11-10

A read-only evidence check of the original drink-water task's pre-migration
snapshot produced one eligible task and no skipped tasks, retaining the original
`custom-enterpri:default` account. The helper's output was intercepted in memory;
this check did not write to the user's runtime state or run their task.

The fresh native probe passed on Windows with Node 24.20.0 and the patched
OpenClaw 2026.10.10 runtime:

```sh
node scripts/test-cron-upgrade.mjs --biz-root D:/GitHub/clawx-biz
```

Three synthetic tasks ran successfully across two Gateway starts: community
and enterprise inherited models, plus an explicit removed community model.
All six runs returned `ok` using the current model. Both attempts at the removed
model returned a real loopback HTTP 404 before succeeding through fallback.
The fixture included a historical automatic enterprise account selection and
an initially absent main-agent database, exercising native account enrollment
during startup. Disabled state and payloads remained unchanged.

Between starts, the probe captured a populated receipt through the Biz helper,
removed the enterprise profile and projected the same key again. Native
continuation changed the authorization ID while retaining every other binding
field. The final artifact was
`clawx-native-cron-upgrade-Sms7jr/result.json`, with `passed`,
`missingMainDatabaseAtBootstrap` and `enterpriseContinuityVerified` all true.

A focused follow-up also passed:

```sh
node scripts/test-cron-upgrade.mjs --biz-root D:/GitHub/clawx-biz --reuse C:/Users/70954/clawx-native-cron-upgrade-Sms7jr --auto-continuity
```

After setting only the synthetic binding's source metadata to `auto`, native
capture, profile removal/reprojection and continuation retained that source,
provider and profile while renewing the authorization ID. One further enterprise
run succeeded; `auto-result.json` records `passed: true`.

These were Doctor-bootstrapped canonical fixtures and actual local inference
requests. Runs were forced only after observing completed binding recovery.
They do not establish full old-installer conversion, real enterprise login or
a packaged application restart. The Biz suite separately passed 37 files /
317 tests plus `pnpm typecheck` against the matching community checkout.

## Install-lifecycle correction on 2026-11-11

CI exposed a delivery defect after those runtime probes: the patch added
`dist/clawx-cron-inference-migration.mjs` without adding it to OpenClaw's
`dist/postinstall-inventory.json`. The native postinstall cleanup removes files
outside that inventory. Consequently, both migration test suites could not
import the helper, and the patched-runtime syntax check reported the same
missing file. Those failures correctly detected a real installation defect.

The earlier manually prepared runtime and isolated Gateway probes did not
validate the full dependency installation lifecycle. New runtime files must
survive the native cleanup as well as work when present. The correction updates
the inventory and exercises the actual pruning implementation in an isolated
package, preserving the migration helper while still removing a stale file.
The syntax check continues to cover every patched JavaScript chunk; JSON
inventory data is validated as JSON instead of being passed to `node --check`.

Validation of this correction:

- The original patch's isolated package contained the helper before the native
  postinstall, then lost it after that script exited successfully. The script
  explicitly reported the helper as a pruned stale file.
- With the corrected patch, normal preinstall/postinstall hooks completed, all
  54 patched files matched, and the helper passed `node --check` and loaded all
  four exports. The top-level Windows pnpm process did not finish its remaining
  bookkeeping, so this is lifecycle evidence, not a claimed successful full
  repository install. Fresh CI installation remains the final end-to-end check.
- The three affected suites passed all 86 tests with file parallelism disabled,
  including the native registered/unregistered pruning controls. ESLint, task
  validation/dry run, and communication replay/comparison also passed.

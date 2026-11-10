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
tests. Record actual commands/results in the task or a dated follow-up; this
document does not claim those layers passed before they are run.

## Validation on 2026-11-10

A read-only evidence check of the original drink-water task's pre-migration
snapshot produced one eligible task and no skipped tasks, retaining the original
`custom-enterpri:default` account. The helper's output was intercepted in memory;
this check did not write to the user's runtime state or run their task.

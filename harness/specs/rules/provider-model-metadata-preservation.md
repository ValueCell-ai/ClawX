---
id: provider-model-metadata-preservation
title: Provider Model Metadata Preservation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

When ClawX rewrites an explicit `models.providers.*` entry, existing model rows
must be merged by exact model ID instead of reconstructed from only `id` and
`name`.

All fields on an existing matching row are user/runtime-owned metadata and must
survive provider save, update, default-switch, and reload flows unless a task
explicitly owns that field.

New model IDs may receive deterministic capability defaults, but metadata from a
different model ID must never be copied onto them.

Custom-provider model rows (`models.providers.custom-*`) must not receive an
inferred `contextWindow` or `contextTokens` from their model names. Existing
rows missing both fields remain unset. Rows that already declare either field
are user-owned and must never be modified. Compaction applies transport ceilings
to explicit values and otherwise uses the 50000-token reserve fallback.

Provider-level request settings are also preserved on rewrite. ClawX must not
inject a default `timeoutSeconds` into provider entries; absent values remain
absent and explicit values remain user-owned.

One narrow compatibility default is ClawX-owned: an Astra model under a
`custom-*` provider using `openai-completions` receives
`agents.defaults.models["provider/model"].params.extra_body.reasoning_effort =
"none"` when no reasoning effort is already configured. OpenClaw reads request
parameters from this per-model runtime map, not provider-catalog rows in
`models.providers.*.models` or per-Agent `models.json`. Never overwrite an
explicit reasoning-effort value, and do not apply the default to other models,
protocols, or providers. Provider deletion must remove matching entries from
both default and per-Agent model catalogs so generated runtime parameters do
not leave stale models behind. When deletion empties an `agents.*.models` map,
keep an explicit empty object in the `config.set` payload: OpenClaw treats this
as a protected map and preserves its old entries when the field is omitted.

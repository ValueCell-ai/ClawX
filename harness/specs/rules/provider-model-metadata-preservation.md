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

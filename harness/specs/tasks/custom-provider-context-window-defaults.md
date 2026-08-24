---
id: custom-provider-context-window-defaults
title: Explicit contextWindow defaults and compaction safeguard for custom providers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Give custom-provider model rows an explicit contextWindow (inferred by model family), keep agents.defaults.compaction.reserveTokensFloor at 50000, and enable midTurnPrecheck so OpenClaw can recover before long or tool-heavy sessions exceed the context window.
touchedAreas:
  - harness/specs/tasks/custom-provider-context-window-defaults.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/shared/providers/model-capabilities.ts
  - electron/utils/openclaw-auth.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Saving or updating a custom provider writes model rows that include an inferred contextWindow, so OpenClaw's preemptive compaction and context-window guard are active for custom models.
  - Existing custom provider model rows that already carry contextWindow or contextTokens are never modified.
  - On app start, custom-provider model rows missing both contextWindow and contextTokens are backfilled with an inferred contextWindow, and agents.defaults.compaction is seeded to safeguard mode when the user has no compaction config.
  - Existing installs keep their reserveTokensFloor value and receive midTurnPrecheck.enabled=true when that option is missing; explicit midTurnPrecheck.enabled values remain unchanged.
  - Long and tool-heavy sessions on custom providers are compacted before overflowing instead of surfacing "Context overflow" errors.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - provider-model-metadata-preservation
  - renderer-main-boundary
requiredTests:
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
acceptance:
  - New custom-provider model rows written by explicit provider sync include an inferred contextWindow matching the model-family table in model-capabilities.
  - The startup batch sync backfills contextWindow only on models.providers.custom-* rows lacking both contextWindow and contextTokens; registry and non-custom providers are never touched.
  - agents.defaults.compaction is seeded to { mode: "safeguard", reserveTokensFloor: 50000, midTurnPrecheck: { enabled: true } } only when no compaction config exists.
  - Existing reserveTokensFloor values, including the previous ClawX default of 50000, are unchanged on upgrade; a missing reserveTokensFloor may still be backfilled to 50000 as before.
  - A missing midTurnPrecheck setting or enabled field is backfilled to enabled=true, while an explicit enabled value is preserved.
  - Renderer transport boundaries remain unchanged.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Background

ClawX wrote custom-provider model rows with only `{ id, name, input }`. Without
`contextWindow` (or `contextTokens`), OpenClaw's embedded runner cannot budget
preemptive compaction or the context-window guard, so long sessions on custom
providers only fail at the provider with "Context overflow: prompt too large
for the model. Try /reset (or /new) ...". Users also had no
`agents.defaults.compaction` config, so no safeguard compaction ran.

## Scope

- Infer a conservative `contextWindow` per model family for custom-provider
  model rows (new writes in `upsertOpenClawProviderEntry` and per-agent
  `models.json` merges).
- Backfill missing `contextWindow` on existing `models.providers.custom-*`
  rows during the startup batch config sync.
- Seed `agents.defaults.compaction.mode = "safeguard"` when the user has no
  compaction config.
- Keep `agents.defaults.compaction.reserveTokensFloor = 50000` and seed
  `midTurnPrecheck.enabled = true` alongside safeguard mode so tool-loop
  pressure uses OpenClaw's existing recovery path.
- On upgrade, backfill a missing `midTurnPrecheck.enabled` without changing an
  existing reserveTokensFloor or an explicit mid-turn precheck choice.
- Add regression tests and translated documentation.

## Out Of Scope

- Renderer UI for editing contextWindow per model.
- Writing `maxTokens` for non-anthropic providers (changes request payloads).
- Backfill for non-custom (registry/ollama) provider entries.

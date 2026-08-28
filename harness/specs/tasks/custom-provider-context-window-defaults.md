---
id: custom-provider-context-window-defaults
title: Explicit context metadata and compaction safeguard for custom providers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve explicitly supplied custom-provider context metadata, keep agents.defaults.compaction.reserveTokensFloor at 50000 when metadata is absent, and enable midTurnPrecheck so OpenClaw can recover before long or tool-heavy sessions exceed its effective context window.
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
  - Saving or updating a custom provider preserves an explicitly supplied contextWindow or contextTokens without inferring missing context metadata from the model name.
  - Existing custom provider model rows that already carry contextWindow or contextTokens are never modified, and rows missing both fields remain unset.
  - On app start, agents.defaults.compaction is seeded to safeguard mode when the user has no compaction config; missing explicit context metadata keeps reserveTokensFloor at 50000.
  - Existing installs reset reserveTokensFloor to 50000 when the selected model has no explicit context metadata and receive midTurnPrecheck.enabled=true when that option is missing; explicit midTurnPrecheck.enabled values remain unchanged.
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
  - New custom-provider model rows written by provider sync do not invent a contextWindow from model-family naming rules.
  - The startup batch sync leaves models.providers.* rows lacking both contextWindow and contextTokens unchanged.
  - agents.defaults.compaction is seeded to { mode: "safeguard", reserveTokensFloor: 50000, midTurnPrecheck: { enabled: true } } only when no compaction config exists.
  - reserveTokensFloor is 25% of an explicit effective context limit and otherwise is reset or backfilled to 50000.
  - A missing midTurnPrecheck setting or enabled field is backfilled to enabled=true, while an explicit enabled value is preserved.
  - Renderer transport boundaries remain unchanged.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Background

ClawX previously inferred `contextWindow` from model-family names. That guess
can differ from the effective limit selected by OpenClaw, making the compaction
reserve larger than the usable prompt budget. Missing metadata must therefore
remain unknown to ClawX, with the conservative reserve fallback handling that
case. Users also need an `agents.defaults.compaction` safeguard configuration.

## Scope

- Preserve explicit `contextWindow` or `contextTokens` values in custom-provider
  model rows and per-agent `models.json` merges.
- Do not infer or backfill missing context metadata from model names.
- Seed `agents.defaults.compaction.mode = "safeguard"` when the user has no
  compaction config.
- Keep `agents.defaults.compaction.reserveTokensFloor = 50000` when context
  metadata is absent and seed `midTurnPrecheck.enabled = true` alongside
  safeguard mode so tool-loop pressure uses OpenClaw's existing recovery path.
- On upgrade, backfill a missing `midTurnPrecheck.enabled`, preserve an explicit
  precheck choice, and reset a stale inferred reserve floor to 50000 when the
  selected model has no explicit context metadata.
- Add regression tests and translated documentation.

## Out Of Scope

- Renderer UI for editing contextWindow per model.
- Writing `maxTokens` for non-anthropic providers (changes request payloads).
- Backfill for non-custom (registry/ollama) provider entries.

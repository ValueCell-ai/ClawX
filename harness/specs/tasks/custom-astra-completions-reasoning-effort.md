---
id: custom-astra-completions-reasoning-effort
title: Default Astra custom completions requests to disabled reasoning
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make custom Astra models usable through OpenAI Chat Completions endpoints that require an explicit reasoning_effort of none when function tools are present.
touchedAreas:
  - harness/specs/tasks/custom-astra-completions-reasoning-effort.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Saving or selecting a custom Astra model with the OpenAI Completions protocol adds agents.defaults.models["provider/model"].params.extra_body.reasoning_effort=none when no reasoning_effort is already configured.
  - An explicitly configured reasoning_effort remains unchanged.
  - Custom non-Astra models, Astra models using another protocol, and non-custom providers remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-config-delivery
  - provider-model-metadata-preservation
  - renderer-main-boundary
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - Custom Astra models using openai-completions receive agents.defaults.models["provider/model"].params.extra_body.reasoning_effort=none only when the field is absent.
  - Provider catalog rows and per-Agent models.json remain request-parameter agnostic.
  - Existing reasoning_effort values and unrelated model metadata are preserved.
  - Removing a provider also removes its entries from default and per-Agent model catalogs, using an explicit empty map when the final protected catalog entry is removed.
  - No Renderer, Host API, provider form, or transport-selection behavior changes.
  - Focused tests, typecheck, harness validation, communication replay, and communication comparison pass.
docs:
  required: false
references:
  - harness/reference/openclaw-config-delivery.md
---

## Background

Some OpenAI-compatible relays expose Astra aliases only through
`/v1/chat/completions`. Their upstream model rejects function tools unless the
request explicitly contains `reasoning_effort: "none"`; omitting the field is
not equivalent to disabling reasoning, while the relay does not expose a usable
Responses deployment.

## Scope

- Detect custom provider keys, Astra model IDs, and `openai-completions`.
- Add `params.extra_body.reasoning_effort = "none"` to the matching
  `agents.defaults.models["provider/model"]` entry when no reasoning effort is
  already configured.
- Keep provider catalog rows and per-Agent `models.json` synchronization free
  of request-only parameters that OpenClaw does not read there.
- Remove the corresponding runtime-parameter catalog entry when its provider is
  deleted, retaining an explicit empty protected model map when it was the final
  entry.
- Preserve all explicit model metadata and reasoning-effort values.
- Add focused regression coverage.

## Out Of Scope

- New provider UI fields.
- Protocol auto-switching or request retries.
- Astra handling for built-in providers or non-completions transports.
- General reasoning capability inference from model names.
- README or user documentation changes for this internal compatibility default.

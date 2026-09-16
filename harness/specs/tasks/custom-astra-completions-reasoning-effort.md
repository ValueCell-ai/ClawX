---
id: custom-astra-completions-reasoning-effort
title: Default Astra custom completions requests to low reasoning
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make custom Astra models usable through OpenAI Chat Completions endpoints whose upstream no longer supports reasoning_effort none.
touchedAreas:
  - harness/specs/tasks/custom-astra-completions-reasoning-effort.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Startup sanitization, saving, or selecting a custom Astra model with the OpenAI Completions protocol adds agents.defaults.models["provider/model"].params.extra_body.reasoning_effort=low when no reasoning_effort is already configured.
  - Startup sanitization migrates a legacy ClawX-generated reasoning_effort=none value to low so existing users do not keep sending an unsupported value.
  - An explicitly configured reasoning_effort other than the legacy none value remains unchanged.
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
  - Custom Astra models using openai-completions receive agents.defaults.models["provider/model"].params.extra_body.reasoning_effort=low when the field is absent.
  - Existing ClawX-generated params.extra_body.reasoning_effort=none values on matching models are migrated to low before Gateway launch.
  - Provider catalog rows and per-Agent models.json remain request-parameter agnostic.
  - Existing non-none reasoning_effort values and unrelated model metadata are preserved.
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
`/v1/chat/completions`. Their upstream model requires an explicit supported
reasoning effort when function tools are present and no longer accepts
`reasoning_effort: "none"`. Older ClawX releases generated that now-invalid
value, so merely changing the default would leave existing users broken.

## Scope

- Detect custom provider keys, Astra model IDs, and `openai-completions` during
  prelaunch sanitization and provider synchronization.
- Add `params.extra_body.reasoning_effort = "low"` to the matching
  `agents.defaults.models["provider/model"]` entry when no reasoning effort is
  already configured.
- Migrate the exact legacy ClawX-generated
  `params.extra_body.reasoning_effort = "none"` value to `"low"` for matching
  Astra runtime entries.
- Keep provider catalog rows and per-Agent `models.json` synchronization free
  of request-only parameters that OpenClaw does not read there.
- Remove the corresponding runtime-parameter catalog entry when its provider is
  deleted, retaining an explicit empty protected model map when it was the final
  entry.
- Preserve all explicit model metadata and non-none reasoning-effort values.
- Add focused regression coverage.

## Out Of Scope

- New provider UI fields.
- Protocol auto-switching or request retries.
- Astra handling for built-in providers or non-completions transports.
- General reasoning capability inference from model names.
- README or user documentation changes for this internal compatibility default.

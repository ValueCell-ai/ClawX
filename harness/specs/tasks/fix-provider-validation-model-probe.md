---
id: fix-provider-validation-model-probe
title: Validate provider credentials with the configured model
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent custom and plan-specific provider endpoints from rejecting ClawX credential validation because the fallback request uses a fabricated validation-probe model instead of the model configured by the user.
touchedAreas:
  - harness/specs/tasks/fix-provider-validation-model-probe.md
  - shared/host-api/contract.ts
  - src/components/settings/ProvidersSettings.tsx
  - src/stores/providers.ts
  - electron/services/providers-api.ts
  - electron/services/providers/provider-validation.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-store-validation.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Adding or updating a provider validates the API key with the model ID currently configured in the form.
  - Plan-specific OpenAI-compatible endpoints no longer receive the fabricated validation-probe model.
  - Existing validation behavior remains available when no model ID is configured.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/provider-validation.test.ts
  - tests/unit/provider-store-validation.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - ProviderValidationOptions carries an optional model ID across the typed renderer-to-Main boundary.
  - Add and edit provider flows include the current model ID when validating an API key.
  - OpenAI Responses and Chat Completions fallback probes use the configured model ID when present.
  - Unit tests verify model propagation from the store through Main and into both OpenAI-compatible probe payloads.
  - Electron E2E coverage verifies add and edit forms include their configured model in validation requests.
  - Renderer does not add direct IPC or Gateway HTTP calls.
docs:
  required: true
---

## Background

OpenAI-compatible validation first requests `/models`. When that endpoint is unavailable, ClawX
falls back to a minimal generation request. That request currently hard-codes
`model: validation-probe`, even though the provider form already has the actual model ID.
Plan-specific endpoints can reject the fabricated model before credential validity can be
established, blocking an otherwise valid provider configuration.

## Scope

- Carry the current model ID through the existing typed provider validation route.
- Use that model for OpenAI Responses and Chat Completions fallback probes.
- Preserve the existing placeholder fallback for validation callers that have no configured model.
- Cover the renderer store, Main service, and validation request payload.

## Out of scope

- Changing provider presets or supported model catalogs.
- Changing how successful provider configurations are persisted.
- Translating upstream provider error messages.

---
id: deliver-catalog-free-provider-runtime-config
title: Deliver runtime config for providers that carry no backend preset
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make Anthropic and Google accounts reach the OpenClaw runtime instead of being silently dropped during provider synchronization, and stop a single malformed transcript record from discarding a whole session's token usage history.
touchedAreas:
  - harness/specs/tasks/deliver-catalog-free-provider-runtime-config.md
  - harness/specs/tasks/refresh-million-token-provider-defaults.md
  - harness/specs/tasks/deepseek-flash-default-and-vision.md
  - electron/shared/providers/registry.ts
  - electron/services/providers/provider-validation.ts
  - electron/utils/token-usage-core.ts
  - tests/unit/providers.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/token-usage.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  # Shared with the sibling default-model specs listed above, which are still
  # uncommitted in the same working tree.
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/e2e/developer-mode.spec.ts
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
expectedUserBehavior:
  - Saving an Anthropic or Google account writes its API key and its selected model into the OpenClaw runtime config, so the account is usable without restarting the app.
  - Anthropic and Google accounts accept a model id the bundled OpenClaw catalog does not know, because ClawX registers the model explicitly.
  - Validating an Anthropic or Google key whose model id the provider does not serve reports the missing model instead of reporting success.
  - Validation still succeeds when the provider does not let ClawX enumerate models, so an unlistable but working model stays configurable.
  - The Dashboard and Models token usage charts keep every usable record in a session whose transcript also contains a malformed one.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - openclaw-config-delivery
  - provider-model-selection-authority
  - provider-model-metadata-preservation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/providers.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/token-usage.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
acceptance:
  - Anthropic and Google declare a `providerConfig` with a base URL, an api protocol drawn from `OPENCLAW_API_PROTOCOLS`, and their existing key env var.
  - Provider synchronization resolves a runtime context for Anthropic and Google, so the auth profile write, the `models.providers` write, and the agent model sync all run for them.
  - A test asserts that every non-local built-in provider resolves a runtime sync context, so a future provider added without a backend preset fails loudly instead of silently skipping delivery.
  - Google validation compares the configured model id against the provider's model listing and reports an unknown model as a validation failure naming the model.
  - Google validation still reports the key as valid when the listing request fails or returns no usable model names.
  - Transcript parsing skips a record whose line, `message`, or `message.details` is not an object, and keeps the remaining records in the same file.
  - A test covers a `toolResult` record whose `details` is a string and asserts the sibling usage records still load.
  - Renderer code adds no direct IPC, Gateway HTTP, or Gateway WebSocket calls.
  - Focused tests, harness validation, communication replay, communication compare, typecheck, and lint pass.
docs:
  required: true
---

## Background

Two independent defects surfaced together while testing a freshly added Google
account in the development build.

**Providers without a backend preset never reach the runtime.** `PROVIDER_DEFINITIONS`
gives most built-in providers a `providerConfig` holding a base URL, an api
protocol, and a key env var. Anthropic and Google were the only non-local
providers without one, on the assumption that OpenClaw's own built-in provider
definitions plus the injected `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` would cover
them. They do not. `resolveRuntimeSyncContext` derives `api` from the account's
`apiProtocol` or `providerConfig.api`, and returns `null` when neither exists.
That null aborts `syncProviderToRuntime` before it writes the auth profile,
before `syncProviderConfigToOpenClaw` can add a `models.providers` entry, and
before the agent model sync. A saved Google account therefore leaves no trace in
the runtime: no auth profile, no provider entry, no agent model row. The
account-creation route is the worst case, because unlike the legacy save route
it has no separate key-delivery call to fall back on.

Relying on OpenClaw's built-in catalog also caps these two providers at whatever
model ids the bundled runtime happens to know. The bundled catalog stops at
`gemini-3.5-flash` and `claude-opus-4.8`, so the current defaults resolve to
nothing. Writing an explicit `models.providers` entry is what makes a newer model
id usable, and it is the same mechanism every other built-in provider already
uses.

**Key validation cannot see this class of failure.** Google validation issues a
one-row model listing purely to prove the key works, and ignores the model id the
form already carries. A configuration whose model does not exist therefore
validates as healthy and fails later, at the first turn, with a provider-side
error that does not name ClawX's own default as the cause.

**One malformed transcript record discards a whole session.** `parseUsageEntriesFromJsonl`
casts each parsed line to `TranscriptLineShape` and then tests
`'usage' in message.details`. The interface declares `details` as an object, but
the cast is unchecked and OpenClaw writes `details` as a plain string whenever a
tool returns raw text. The `in` operator throws on a primitive, the throw escapes
the per-line loop to the per-file handler in `token-usage.ts`, and every usage
record in that transcript is dropped. The chart silently loses the session, and
the log repeats the failure on each poll.

## Scope

- Give Anthropic and Google a `providerConfig` so provider synchronization treats
  them like every other built-in provider and delivers key, provider entry, and
  agent model row.
- Guard the registry with a test that asserts runtime-context resolution for all
  non-local built-in providers, so the missing-preset failure cannot silently
  return.
- Compare the configured model id against Google's model listing during
  validation, and fail with a message naming the model when the listing is
  usable and the model is absent.
- Make transcript parsing total with respect to record shape, and confine a
  malformed record's effect to that record.

## Out Of Scope

- Changing the default model ids themselves; `refresh-million-token-provider-defaults`
  owns those, and this change is what makes them deliverable.
- Adding explicit `models` catalog rows with context windows for Anthropic and
  Google. Catalog rows only reach disk through the default-provider path, so
  adding them here would repeat the delivery gap this spec exists to remove.
- Model-existence checks for providers whose listing endpoint is unauthenticated
  or absent, where a missing model cannot be distinguished from an unlistable one.
- Repairing transcripts already on disk, or changing how OpenClaw serializes
  `toolResult.details`.
- Cleaning up stored key material left behind by deleted provider accounts.

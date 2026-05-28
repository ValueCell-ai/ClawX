---
id: openai-api-key-pin-pi-agent-runtime
title: Pin the embedded "pi" agent runtime on OpenAI provider entries to avoid the unbundled "codex" harness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop OpenClaw from auto-routing OpenAI provider entries (api.openai.com baseUrl) to the externally-bundled "codex" agent harness, which is not registered in the shipped ClawX/OpenClaw distribution and causes chats/heartbeats to fail with `Requested agent harness "codex" is not registered.`. Pin `agentRuntime.id = "pi"` on every `models.providers.openai` and `models.providers.openai-codex` entry ClawX writes, and self-heal existing on-disk entries before provider switches and before Gateway launch so upgrading users do not have to re-save their provider manually.
touchedAreas:
  - harness/specs/tasks/openai-api-key-pin-pi-agent-runtime.md
  - electron/utils/openclaw-auth.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/gateway/config-sync.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Configuring OpenAI with an API key (default `https://api.openai.com/v1` baseUrl) and starting a chat succeeds without `Requested agent harness "codex" is not registered.` from the Gateway.
  - OpenAI browser-OAuth/Codex accounts that use the runtime provider key `openai-codex` also run through the embedded `pi` runtime unless the user has explicitly configured a different installed harness.
  - Upgrading from an earlier ClawX build that wrote `openai` or `openai-codex` provider entries without `agentRuntime` self-heals those entries on the next provider switch and during pre-launch config sanitization before Gateway reads the config.
  - A pre-existing user-supplied non-empty `agentRuntime.id` is preserved; the ClawX pin only fills missing runtime policy.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/openclaw-auth.test.ts
acceptance:
  - `electron/utils/openclaw-auth.ts` applies a shared OpenAI runtime-pin helper from all ClawX write/self-heal paths and pins `agentRuntime: { id: 'pi' }` on `models.providers.openai` and `models.providers.openai-codex` entries that lack a non-empty runtime id.
  - `syncProviderConfigToOpenClaw(...)`, `setOpenClawDefaultModel(...)`, and `setOpenClawDefaultModelWithOverride(...)` continue to pin OpenAI provider entries through `upsertOpenClawProviderEntry`.
  - `ensureOpenClawProviderAgentRuntimePins()` still repairs legacy on-disk entries and is invoked inside `syncDefaultProviderToRuntime` right after `pruneInvalidApiProviderEntries`, before either the OAuth or non-OAuth branch runs.
  - `sanitizeOpenClawConfig()` repairs missing OpenAI runtime pins during Gateway pre-launch sanitization so a stale config cannot boot into the unregistered `codex` harness path.
  - `batchSyncConfigFields()` also applies the same shared helper during pre-launch config writes, covering the fallback path if sanitization skipped or failed.
  - Renderer does not add new direct ipcRenderer or Gateway HTTP calls.
  - Unit tests cover (a) the write-path pin via `syncProviderConfigToOpenClaw('openai', ...)`, (b) the OAuth-path pin via `syncProviderConfigToOpenClaw('openai-codex', ...)`, (c) preservation of a user-supplied override, (d) the self-heal helper for legacy on-disk entries, and (e) `sanitizeOpenClawConfig()` pre-launch repair.
docs:
  required: false
---

## Background

OpenClaw 2026.5+ ships a provider-routing policy
([node_modules/openclaw/dist/policy-B5E74dCu.js](node_modules/openclaw/dist/policy-B5E74dCu.js),
[node_modules/openclaw/dist/openai-codex-routing-qYpDQzyG.js](node_modules/openclaw/dist/openai-codex-routing-qYpDQzyG.js))
that can route OpenAI-compatible official endpoints through a separate
`codex` agent harness. The intent is to give OpenAI/Codex accounts a richer
trajectory, but the shipped ClawX distribution does not register an agent
harness with id `"codex"`.

When an OpenAI provider entry lacks an explicit runtime pin, affected chat and
heartbeat runs can fail inside OpenClaw harness selection with:

```
Requested agent harness "codex" is not registered.
```

Provider-side validation can still pass (credentials and protocol are valid);
the failure is about agent harness selection. ClawX therefore writes an
explicit `agentRuntime: { id: "pi" }` for OpenAI provider entries that it owns.
OpenClaw's policy resolver honours explicit provider/model runtime policy
before falling into the codex auto-routing heuristic.

## Scope

- Maintain the `OPENCLAW_PROVIDER_PINNED_AGENT_RUNTIME` map in
  `electron/utils/openclaw-auth.ts` (`openai` and `openai-codex` currently map
  to `pi`). Future providers can be added to the map without changing the
  plumbing.
- Use one shared helper to apply the map to `models.providers.*` entries. The
  helper must preserve non-empty user-provided `agentRuntime.id` values.
- Call the helper from provider write paths, explicit self-heal, and Gateway
  pre-launch config sanitation (`sanitizeOpenClawConfig` plus the batched
  pre-launch config write).
- Cover the write path, self-heal path, override-preservation path, and
  pre-launch sanitize path in unit tests.

## Out of scope

- Upstream changes to OpenClaw's policy resolver so it would only auto-route to
  `codex` when a `codex` harness is actually registered.
- UI for choosing an agent runtime per provider.
- README updates (no user-visible UI flow change).

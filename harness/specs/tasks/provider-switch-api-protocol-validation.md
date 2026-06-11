---
id: provider-switch-api-protocol-validation
title: Reject invalid OpenClaw api protocol writes and self-heal stale entries
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent ClawX from writing models.providers.*.api values outside the OpenClaw allowlist into openclaw.json, and opportunistically prune pre-existing invalid entries when the user switches default provider so a clean switch can rescue the Gateway from Invalid-config restart loops.
touchedAreas:
  - harness/specs/tasks/provider-switch-api-protocol-validation.md
  - electron/shared/providers/registry.ts
  - electron/shared/providers/types.ts
  - electron/utils/openclaw-auth.ts
  - electron/services/providers/provider-runtime-sync.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Selecting OpenRouter (or any built-in provider) as default writes a Gateway-valid api protocol so Gateway reload stays healthy.
  - Attempting to save a provider whose api protocol is not in the OpenClaw allowlist surfaces an actionable error in the UI without polluting openclaw.json or triggering a Gateway restart.
  - Switching default to a healthy provider after a prior corrupt openclaw.json (legacy api=openrouter typo) self-heals the file before the next reload signal so the Gateway boots cleanly.
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
  - electron/shared/providers/types.ts exports OPENCLAW_API_PROTOCOLS as the single source of truth for openclaw.json api values, plus assertValidApiProtocol and InvalidApiProtocolError.
  - setOpenClawDefaultModel, setOpenClawDefaultModelWithOverride, syncProviderConfigToOpenClaw, and upsertOpenClawProviderEntry all invoke assertValidApiProtocol before any write to openclaw.json.
  - syncDefaultProviderToRuntime calls pruneInvalidApiProviderEntries before the OAuth and non-OAuth branches so a switch to any healthy provider drops legacy invalid models.providers entries.
  - Renderer does not add new direct ipcRenderer or Gateway HTTP calls.
  - Unit tests cover both the rejection path (no file write on invalid api) and the self-heal path (legacy entries pruned while valid ones remain).
docs:
  required: false
---

## Background

A historical bug in [electron/shared/providers/registry.ts](electron/shared/providers/registry.ts) set the OpenRouter
`providerConfig.api` to the literal string `'openrouter'`, which is not in OpenClaw's allowed
`api` enum (`openai-completions | openai-responses | openai-chatgpt-responses | anthropic-messages |
google-generative-ai | github-copilot | bedrock-converse-stream | ollama | azure-openai-responses`).

When the user selected OpenRouter as their default provider, ClawX wrote that invalid value into
`~/.openclaw/openclaw.json` and then sent SIGUSR1 to the running Gateway. The Gateway's
`assertValidGatewayStartupConfigSnapshot` rejected the config, tore down all channels (close code
1012), entered the `startup_failed` state, but kept the OS process alive. The Main process then
spun for ~8 minutes inside `waitForGatewayReady` before doctor self-heal kicked in.

Switching to MiniMax during the broken window did not help, because the runtime-sync path only
appended the MiniMax block and left the broken OpenRouter entry untouched.

## Scope

- Fix the registry typo so OpenRouter writes `api: 'openai-completions'`, matching every other
  OpenAI-compatible built-in provider.
- Add a single source of truth for the allowed api protocols and a runtime guard at every write
  site (`setOpenClawDefaultModel`, `setOpenClawDefaultModelWithOverride`,
  `syncProviderConfigToOpenClaw`, plus defense-in-depth inside `upsertOpenClawProviderEntry`).
- Add a self-heal helper that prunes any `models.providers.*` entry whose `api` is outside the
  allowlist, and invoke it at the top of `syncDefaultProviderToRuntime` so a clean switch rescues
  legacy corrupted configs.

## Out of scope

- Gateway-side `waitForGatewayReady` short-circuit when the owned process is stuck in
  `startup_failed`.
- Renderer pre-flight validation UI surface beyond the existing route-level error handling.
- README updates (no user-visible UI change in this task).

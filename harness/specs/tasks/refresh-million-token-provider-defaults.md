---
id: refresh-million-token-provider-defaults
title: Refresh built-in provider defaults to the current million-token models
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move the Anthropic, Google, Moonshot (CN and Global), OpenRouter, SiliconFlow, and Z.AI (CN and Global) built-in defaults to the current million-token generation, and register image input for the ones the vendor actually serves as multimodal.
touchedAreas:
  - harness/specs/tasks/refresh-million-token-provider-defaults.md
  - harness/specs/tasks/deepseek-flash-default-and-vision.md
  - harness/specs/tasks/deliver-catalog-free-provider-runtime-config.md
  - electron/shared/providers/registry.ts
  - electron/shared/providers/model-capabilities.ts
  - src/lib/providers.ts
  - tests/unit/providers.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/developer-mode.spec.ts
  # Shared with deliver-catalog-free-provider-runtime-config, which is still
  # uncommitted in the same working tree.
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/token-usage.test.ts
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
expectedUserBehavior:
  - Selecting Anthropic in the add-provider dialog prefills claude-opus-5.
  - Selecting Google prefills gemini-3.8-flash.
  - Selecting Moonshot (CN) or Moonshot (Global) prefills kimi-k3.
  - Selecting OpenRouter prefills ~deepseek/deepseek-flash-latest, the tilde-prefixed floating alias OpenRouter publishes for DeepSeek-V4.1-Flash.
  - Selecting SiliconFlow prefills zai-org/GLM-5.3.
  - Selecting Z.AI (CN) or Z.AI (Global) prefills glm-5.3-flash in both API and Code Plan modes.
  - Saving any of those accounts without editing the model id starts the runtime on the prefilled model with a million-token context window.
  - Images attached to an Anthropic, Google, Moonshot, OpenRouter, or Z.AI chat reach the model; a SiliconFlow GLM-5.3 chat stays text-only.
  - Previously configured accounts keep the model id they were saved with.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - provider-model-metadata-preservation
  - provider-model-selection-authority
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/providers.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/developer-mode.spec.ts
acceptance:
  - The Main and renderer provider registries declare the same default model id and placeholder for every built-in provider, enforced by a test that walks the whole registry rather than one assertion per provider.
  - Moonshot and Z.AI carry explicit catalog rows for kimi-k3 and glm-5.3-flash with input ["text","image"] and a 1M context window, and the retired rows they replace stay in the catalog.
  - Input-modality inference reports text and image for kimi-k3, claude-opus-5, gemini-3.8-flash, glm-5.3-flash, and both the floating ~deepseek/deepseek-flash-latest alias and the pinned deepseek/deepseek-v4.1-flash id.
  - Input-modality inference keeps zai-org/GLM-5.3 text-only, because Z.AI serves GLM-5.3 as a text model and only GLM-5.3-Flash as multimodal.
  - Context-window inference reports 1M for every new default, including the vendor-prefixed and tilde-prefixed aggregator ids.
  - Provider synchronization writes the inferred modalities for OpenRouter and SiliconFlow, which ship no explicit catalog rows, without overwriting an existing explicit input declaration.
  - Renderer code adds no direct IPC, Gateway HTTP, or Gateway WebSocket calls.
  - Translated feature docs describe the Z.AI default model consistently across all four locales.
  - Focused tests, harness validation, communication replay, communication compare, typecheck, and lint pass.
docs:
  required: true
---

## Background

The built-in provider defaults had drifted a generation behind the vendors: they
still pointed at `claude-opus-4-8`, `gemini-3.1-pro-preview`, `kimi-k2.6`,
`glm-5.2`, `openai/gpt-5.6-sol` for OpenRouter, and `deepseek-ai/DeepSeek-V3`
for SiliconFlow. A new account therefore started on a smaller context window
than the vendor offers, and on several providers could not accept images at all.

Two vendor details do not match the obvious guess and are the reason this needs
a spec rather than a search-and-replace:

- OpenRouter prefixes floating "latest" aliases with `~`, so the id is
  `~deepseek/deepseek-flash-latest`; `deepseek/deepseek-flash-latest` does not
  resolve. The pinned equivalent is `deepseek/deepseek-v4.1-flash`.
- Z.AI ships GLM-5.3 as a text-only model and GLM-5.3-Flash as the first
  natively multimodal member of the GLM-5 series. Both have a 1M window, so
  context inference and modality inference must disagree about them.

Image support is not a renderer concern: OpenClaw decides whether to forward
image content from the `input` modalities on each `models.providers.*.models`
row. Providers with an explicit `providerConfig.models` catalog (Moonshot,
Z.AI) take modalities from that row; providers without one (OpenRouter,
SiliconFlow) get them from shared inference during provider synchronization.

## Scope

- Point each listed provider's default model id and placeholder at the current
  million-token model in both the Main registry and the renderer metadata, and
  keep the Z.AI Code Plan preset model id aligned with the API-mode default.
- Add explicit catalog rows for `kimi-k3`, `glm-5.3-flash`, and `glm-5.3`,
  declaring modalities per vendor rather than per family.
- Recognize the new multimodal ids, including OpenRouter's tilde-prefixed
  alias, in shared input-modality inference.
- Guard renderer/Main default parity with a registry-wide test, since a
  half-applied default is the failure mode this change is most prone to.
- Cover the prefilled add-provider model ids with Electron E2E specs and the
  synchronized modalities with unit tests.
- Document the refreshed Z.AI default in all four locales.

## Out Of Scope

- Adding explicit `models` catalogs to OpenRouter or SiliconFlow; both are
  aggregators whose rows should keep coming from the selected model id plus
  shared inference, so user-owned rows are never reconstructed.
- Changing the model id of already configured accounts.
- Marking `kimi-k2.6` image-capable. Moonshot's current docs list image input
  for it, but the shipped catalog row and its tests declare text-only, and
  re-deciding that is a separate change with its own delivery risk.
- Switching SiliconFlow to `zai-org/GLM-5.3-Flash` to gain image input; the
  requested default is the non-Flash model, which stays text-only.
- Chat composer or attachment UI changes.

---
id: deepseek-flash-default-and-vision
title: Default the DeepSeek provider to image-capable deepseek-flash
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move the built-in DeepSeek provider default from deepseek-v4-pro to deepseek-flash (DeepSeek-V4.1-Flash) and register that model as image-capable so provider synchronization writes image input into models.providers.deepseek.
touchedAreas:
  - harness/specs/tasks/deepseek-flash-default-and-vision.md
  - harness/specs/tasks/refresh-million-token-provider-defaults.md
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
  - Selecting DeepSeek in the add-provider dialog prefills the model id field and placeholder with deepseek-flash.
  - Saving a DeepSeek account without editing the model id configures the runtime with deepseek-flash instead of deepseek-v4-pro.
  - Images attached to a DeepSeek chat reach the model because the synchronized model row advertises image input.
  - Keeping or typing deepseek-v4-pro stays available and remains a text-only model.
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
acceptance:
  - The Main and renderer provider registries both declare deepseek-flash as the DeepSeek default model id and placeholder.
  - Input-modality inference reports text and image for deepseek-flash and for the retired deepseek-v4-flash / deepseek-v4-flash-vision-exp ids that DeepSeek routes to V4.1-Flash.
  - Input-modality inference keeps deepseek-v4-pro and deepseek-chat text-only.
  - Provider synchronization writes input ["text","image"] for a new deepseek-flash row without overwriting an existing explicit input declaration.
  - Context-window inference keeps 1M for deepseek-flash, matching DeepSeek's published figure for V4.1-Flash.
  - Renderer code adds no direct IPC, Gateway HTTP, or Gateway WebSocket calls.
  - Translated feature docs describe the DeepSeek default model and its image support consistently.
  - Focused tests, harness validation, communication replay, communication compare, typecheck, and lint pass.
docs:
  required: true
---

## Background

DeepSeek retired V4-Flash and V4-Flash-Vision-Exp and published
DeepSeek-V4.1-Flash under the id `deepseek-flash`, which understands images
natively and keeps the 1M context window. ClawX still defaulted the built-in
DeepSeek provider to `deepseek-v4-pro`, a text-only model, so new DeepSeek
accounts started on the older model and attached images could not reach it.

Image support is not a renderer concern: OpenClaw decides whether to forward
image content from the `input` modalities on each `models.providers.*.models`
row. ClawX fills a missing `input` during provider synchronization using shared
inference, so a vision model must be recognized there to become image-capable.

## Scope

- Point the DeepSeek default model id and placeholder at `deepseek-flash` in
  both the Main registry and the renderer provider metadata.
- Recognize `deepseek-flash` and the retired ids DeepSeek still routes to
  V4.1-Flash as image-capable in shared input-modality inference.
- Cover the prefilled add-provider model id with an Electron E2E spec and the
  synchronized `input` modalities with unit tests.
- Document the DeepSeek default model and image support in all four locales.

## Out Of Scope

- Adding an explicit `models` catalog to the DeepSeek `providerConfig`; the
  model row keeps coming from the selected model id plus shared inference, so
  existing user-owned rows are never reconstructed.
- Changing the model id of already configured DeepSeek accounts.
- Marking `deepseek-v4-pro` image-capable while DeepSeek temporarily serves it
  from V4.1-Flash; the published catalog still lists it as text-only.
- Chat composer or attachment UI changes.

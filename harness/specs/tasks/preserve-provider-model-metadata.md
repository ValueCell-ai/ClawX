---
id: preserve-provider-model-metadata
title: Preserve explicit provider model capabilities during runtime sync
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent ClawX provider save, update, and default-switch flows from deleting user-authored models.providers model metadata, while giving newly selected custom-provider models the same image-input inference used by OpenClaw onboarding.
touchedAreas:
  - docs/superpowers/specs/2026-06-09-provider-model-metadata-preservation-design.md
  - docs/superpowers/plans/2026-06-09-provider-model-metadata-preservation.md
  - harness/specs/tasks/preserve-provider-model-metadata.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/shared/providers/model-capabilities.ts
  - electron/utils/openclaw-auth.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/openclaw-auth.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Switching away from and back to a custom provider keeps manually configured model input capabilities and other model-level metadata.
  - Changing a custom provider to a known vision model such as Claude or Gemini writes image-capable input metadata without copying metadata from the previous model ID.
  - Changing to an unknown model creates a conservative text-only model row instead of silently claiming image support.
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
  - Explicit provider synchronization merges existing models.providers model rows by exact model ID and preserves all fields on existing rows.
  - Newly created runtime model rows receive input metadata matching OpenClaw custom-provider onboarding inference.
  - Metadata from one model ID is never copied to a different model ID.
  - Renderer transport boundaries remain unchanged.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Background

ClawX explicit-provider sync paths rebuild model rows from the currently selected
model ID. Before this task, those paths replaced rich rows such as
`{ id, name, input, reasoning, contextWindow, maxTokens, cost }` with
`{ id, name }`. OpenClaw then treated previously image-capable custom models as
text-only.

## Scope

- Preserve existing explicit provider model rows during save, update, and
  default-provider switch.
- Mirror OpenClaw onboarding's custom-model image-input inference for new model
  IDs.
- Add regression tests and translated documentation.

## Out Of Scope

- New renderer settings or modality controls.
- Copying capability metadata between different model IDs.
- Per-agent `models.json` reconciliation.

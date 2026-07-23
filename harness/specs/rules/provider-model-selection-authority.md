---
id: provider-model-selection-authority
title: Provider Model Selection Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Provider model IDs created through the ClawX settings UI are immutable. Existing
provider edit forms must not submit model changes and must direct users to delete
and recreate the provider when they need a different model ID.

A single-model built-in provider account's explicit `model` is authoritative in
interactive model selectors, regardless of whether it uses an API key, device
OAuth, or browser OAuth. Historical runtime model rows may remain available for
capability preservation, but must not reappear as alternate built-in selections
through synchronized `metadata.customModels`.

Before writing a selected model ID to OpenClaw, strip one leading provider
prefix when it exactly matches the resolved runtime provider key. Preserve all
other slashes because they may be part of a valid model ID.

Custom and local multi-model accounts may continue to project all configured
`metadata.customModels`. Do not collapse their lists to the selected model.

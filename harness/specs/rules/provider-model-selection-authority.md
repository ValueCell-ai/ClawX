---
id: provider-model-selection-authority
title: Provider Model Selection Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

An OAuth provider account's explicit `model` is the authoritative model exposed
for that account in interactive model selectors. Historical runtime model rows
may remain available for capability preservation, but must not reappear as
alternate OAuth selections through synchronized `metadata.customModels`.

Before writing a selected model ID to OpenClaw, strip one leading provider
prefix when it exactly matches the resolved runtime provider key. Preserve all
other slashes because they may be part of a valid model ID.

Custom and local multi-model accounts may continue to project all configured
`metadata.customModels`. Do not collapse their lists to the selected model.

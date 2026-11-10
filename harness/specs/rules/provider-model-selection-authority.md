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

The chat picker changes only the target conversation. Let OpenClaw persist an
explicit selection for that session, and keep Agent configuration as the
inherited default. A model reported for a previous response is usage history
and cannot establish an override on upgrade. Apply a draft's choice to its own
session before dispatching its first prompt.

List concrete configured models in the conversation picker and use the effective
model for its selected state, including inherited defaults. Do not expose a
Follow Agent option or substitute that wording when the current model is unknown;
use the localized model-selection prompt. Opening the picker must not turn an
inherited default into a stored override. Clicking a concrete model persists an
explicit session choice even when it matches the inherited default.
When no configured models are available, retain an existing explicit model's
label and disable the picker rather than opening an empty menu.

Resolve an Agent mention to its main session for model reads, writes and prompt
dispatch. The source conversation continues to own the message draft.

See [Conversation model selection](../../reference/acp-chat.md#conversation-model-selection).

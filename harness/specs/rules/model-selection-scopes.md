---
id: model-selection-scopes
title: Global, Agent and task model choices have separate ownership
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

AI Models manages provider connections and the available model catalog. Do not
expose global-default model selectors or default-provider badges on this page.
Retain native global defaults for compatibility without migrating, backfilling,
deleting, or materializing inherited settings during reads or page navigation.
Existing API clients may still set native defaults; confirm the runtime value
before reporting success instead of relying on a credential account preference.

New assistants created in the UI select an explicit configured model using the
shared ModelPicker. Save it with creation, not a separate follow-up mutation.
Existing assistants display their effective model even when inherited or absent
from the current catalog. Only deliberate selection writes that Agent's model,
preserving fallbacks and unknown fields. Do not expose reset-to-global controls.
Legacy clients may still omit creation models or clear explicit overrides.
Composer selection
belongs only to its destination task/session (the visible chat or the selected
recipient’s main session) and must never call agents.updateModel or clear
an Agent override while browsing. Blank drafts hold their choice locally until
the first prompt creates a native session; existing session overrides persist
through Main-owned Gateway session APIs. The picker displays the effective
model and persists only a concrete selection. Sessions without an explicit
selection inherit their Agent's model. Do not edit native session stores or
change global/Agent config to emulate a task override.

Read and write results are scoped to the requested session. Stale completions
must not change another session's selection, switching failures remain visible,
and a prompt must not silently use the previous model after a failed selection.
Preserve model IDs containing slashes and all provider model metadata.

---
id: model-selection-scopes
title: Global, Agent and task model choices have separate ownership
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

Global model defaults select a concrete configured provider/model, including
imported multi-model accounts with no account-level model. A successful save
must reflect the runtime default, not merely a credential account preference.
Repeated selection must repair stale account/runtime divergence rather than
return success solely because the account ID matches.

Agent details may set or clear that Agent's explicit model. Composer selection
belongs only to its task/session and must never call agents.updateModel or clear
an Agent override while browsing. Blank drafts hold their choice locally until
the first prompt creates a native session; existing session overrides persist
through Main-owned Gateway session APIs. Do not edit native session stores or
change global/Agent config to emulate a task override.

Read and write results are scoped to the requested session. Stale completions
must not change another session's selection, switching failures remain visible,
and a prompt must not silently use the previous model after a failed selection.
Preserve model IDs containing slashes and all provider model metadata.

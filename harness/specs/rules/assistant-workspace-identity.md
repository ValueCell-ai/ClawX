---
id: assistant-workspace-identity
title: Persistent assistant identity uses native OpenClaw workspace files
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - gateway-backend-communication
---

Configured agents are persistent assistant identities. Keep session tasks and temporary
subagent runs separate from the configured roster. Starting an assistant task must
use existing chat ownership and workspace selection, preserve drafts and never send
a prompt automatically. Draft attachments stay in memory across route changes,
remain scoped to their session and transfer with a preserved draft; in-flight staging
must finish in the retained draft even if its original input unmounts. Derive activity
only from real session data.

Work style lives in SOUL.md and operating rules in AGENTS.md. Read and write through
the existing Host API file authority, honor read-only/error states, and preserve full
native file content when editing. Do not invent a separate role/profile database.
Creation instructions seed only the newly provisioned workspace and participate in
the existing provisioning rollback. A copy of initial settings is not live inheritance
of the workspace, conversation history or durable memory.

Use the shared Workspace reader in a thin right drawer for all file previews.
Keep one centered settings dialog with model controls in the same layer; expose
important actions to keyboard users, retain destructive confirmation and use all locales.

Assistant details use overview, files/memory and skills/permissions tabs. Tab changes
preserve unsaved instruction drafts, and starting a task uses the same unsaved-change
protection as closing. The workspace quick-access skill list is not an effective
agent tool-policy or sandbox report; show its actual scope and never guess permissions.
Keep the overview focused on editable identity and model, workspace and messaging;
show native working-style content in the files/memory tab instead of duplicating an excerpt.
Select assistant models from configured provider options. Preserve and display an existing
external model reference in full even when it is absent from the list; opening or closing
the dialog must not rewrite it. Only an explicit configured-model selection changes it.
Assistant cards show labeled model, profile directory and messaging entry points rather
than presenting an arbitrary SOUL.md excerpt as a summary. Keep full account information
available in assistant details when the card summarizes multiple bound accounts.

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

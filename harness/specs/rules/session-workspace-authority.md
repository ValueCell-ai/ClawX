---
id: session-workspace-authority
title: Session Workspace Authority
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - acp-file-activity
  - gateway-backend-communication
---

OpenClaw ACP cwd is authoritative for a bound Chat session. Global workspace selection applies only to new or unbound sessions, and consumers use one effective workspace for ACP load/prompt, composer state, sidebar grouping, workspace browsing, and file activity. Missing paths surface unavailable state instead of silently changing roots.

Custom workspace names are display-only aliases keyed by canonical workspace path. They may change sidebar and composer labels, but never path-based grouping, ACP cwd, browser roots, attachment authority, or session binding.

The ACP load or new-session operation is the only boundary that establishes session workspace context. Main canonicalizes the workspace root and execution cwd, registers them only after a successful load, restores the prior context after failure, and validates later attachment operations by exact session key and generation. Attachment resolve, read, preview, and open requests cannot provide or replace the execution cwd and must be revalidated in Main on every operation. Local attachment references may resolve outside the workspace; the workspace remains authoritative for relative-path resolution and the separate workspace browser and tool-derived file boundaries. Session or generation replacement revokes the prior context; attachment refs and prior resolution are not authority.

Keep `_meta.prefixCwd: true`. Remove the leading working-directory envelope only from automatic titles and narrowly defined turn matching; never alter explicit user labels, user-authored content, or user-visible transcript content.

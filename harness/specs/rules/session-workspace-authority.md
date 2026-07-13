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

The ACP load or new-session operation is the only workspace capability-grant boundary. Main canonicalizes the workspace root and execution cwd, registers them only after a successful load, and authorizes later attachment operations by exact session key and generation. Attachment resolve, read, preview, and open requests cannot provide or replace a workspace root and must be re-authorized in Main on every operation.

Keep `_meta.prefixCwd: true`. Remove the leading working-directory envelope only from automatic titles and narrowly defined turn matching; never alter explicit user labels, user-authored content, or user-visible transcript content.

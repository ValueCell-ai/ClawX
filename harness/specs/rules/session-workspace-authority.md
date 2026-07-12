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

Keep `_meta.prefixCwd: true`. Remove the leading working-directory envelope only from automatic titles; never normalize explicit user labels or user-visible transcript content.

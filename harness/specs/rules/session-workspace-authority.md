---
id: session-workspace-authority
title: Session Workspace Authority
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - acp-file-activity
  - gateway-backend-communication
---

OpenClaw ACP cwd is authoritative for a bound Chat session. Global workspace selection applies only to new or unbound sessions, and consumers use one effective workspace for ACP load/prompt, composer state, sidebar grouping, workspace browsing, and file activity. Editable new or unbound sessions expose persisted recent selections and workspace paths represented by known sessions in the composer; the canonical default appears once, non-default paths are deduplicated, and choosing one updates only the global workspace until the first send binds the session. Main validates the effective workspace before ACP load. Missing paths surface a localized unavailable state instead of repeatedly loading or silently changing roots; only new or unbound sessions may offer an action that replaces the global workspace.

Sidebar group deletion is available only after Main confirms that a non-default workspace is unavailable. It permanently hard-deletes every successfully targeted session through the existing Main-owned session deletion boundary, keeps failed sessions visible, and never treats removal of display metadata as a substitute for deleting transcripts. Per-session deletes run sequentially so updates to an agent's sessions index cannot race.

Custom workspace names are display-only aliases keyed by canonical workspace path. They may change sidebar and composer labels, but never path-based grouping, ACP cwd, browser roots, attachment authority, or session binding.

Targeted `@agent` sends establish the target session placeholder with the target agent workspace before navigation can trigger reactive loading. A target session and its first prompt must share one session-and-workspace load identity; reactive navigation must not supersede that load or silently cancel delivery. If the target main session does not exist yet, the first targeted send creates it before prompting.

The ACP load or new-session operation is the only boundary that establishes session workspace context. Main canonicalizes the workspace root and execution cwd, registers them only after a successful load, restores the prior context after failure, and validates later attachment operations by exact session key and generation. Attachment resolve, read, preview, and open requests cannot provide or replace the execution cwd and must be revalidated in Main on every operation. Local attachment references may resolve outside the workspace; the workspace remains authoritative for relative-path resolution and the separate workspace browser and tool-derived file boundaries. Session or generation replacement revokes the prior context; attachment refs and prior resolution are not authority.

Keep `_meta.prefixCwd: true`. Remove the leading working-directory envelope only from automatic titles and narrowly defined turn matching; never alter explicit user labels, user-authored content, or user-visible transcript content. Treat OpenClaw's `<session UUID prefix> (YYYY-MM-DD)` title as synthetic only when the prefix matches that row's full session id; hydrate it from the first user prompt instead, and never persist an unchanged rename value.

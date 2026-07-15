---
id: attachment-access-safety
title: Attachment Access Safety
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - gateway-backend-communication
---

Treat every Renderer attachment URI, metadata field, staging id, transcript id, and source reference as untrusted. ACP load or creation is the only workspace grant boundary; Main commits the canonical workspace and execution cwd only after success, then authorizes every resolve, scoped read, and local or remote open by the exact active session key and generation. Attachment refs, attachment ids, opaque identities, and a prior successful resolve are not bearer capabilities, and later requests cannot provide or replace a workspace root.

Allow local targets only as canonically contained regular files in the active workspace, the exact runtime state/config `media` subtrees, or a Main-owned staging record bound by id. Outgoing media additionally requires exact attachment, URL-session, record-session, optional message-id, and managed original-file binding. Reject traversal, NUL, unknown or unsafe schemes, remote file authorities, credentials, symlink escapes, parent-root expansion, raw staging paths, and unauthorized outgoing records. Sanitize labels, expose only opaque identities, re-resolve before every operation, and perform final file-handle and generation checks for scoped reads.

Attachment previews must use attachment-scoped read operations and cannot fall back to naked-path or general workspace APIs. System or external open is click-initiated and Main-owned. One unavailable or malformed attachment remains isolated from assistant prose and other attachments. See `harness/reference/acp-attachment-access-control.md`; exact TypeScript contracts and current constants remain code-authoritative.

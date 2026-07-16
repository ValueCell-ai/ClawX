---
id: attachment-access-safety
title: Attachment Access Safety
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - gateway-backend-communication
---

Treat every Renderer attachment URI, metadata field, staging id, transcript id, and source reference as untrusted. A successful ACP load or creation establishes the Main-owned session, generation, workspace, and execution cwd used to resolve references. Main validates every resolve, scoped read, and local or remote open against the exact active session key and generation. Attachment refs, attachment ids, opaque identities, and a prior successful resolve are not bearer capabilities, and later requests cannot provide or replace the execution cwd.

Allow local targets only when an accepted absolute, home-relative, `file:`, or execution-cwd-relative reference resolves to an existing regular file. Local paths are not restricted to the active workspace or managed media roots; workspace/media/staging scope is classification metadata, not a containment grant. A supplied staging id must still match its Main-owned record. Outgoing media URLs additionally require exact attachment, URL-session, record-session, optional message-id, and managed original-file binding. Reject traversal, NUL, unknown or unsafe schemes, remote file authorities, credentials, malformed references, and unauthorized outgoing records. Sanitize labels, expose only opaque identities, re-resolve before every operation, and perform final file-handle and generation checks for scoped reads.

Attachment previews must use attachment-scoped read operations and cannot fall back to naked-path or general workspace APIs. System or external open is click-initiated and Main-owned. One unavailable or malformed attachment remains isolated from assistant prose and other attachments. See `harness/reference/acp-attachment-access-control.md`; exact TypeScript contracts and current constants remain code-authoritative.

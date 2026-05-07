---
id: hard-delete-session-jsonl
title: Hard-delete session JSONL on conversation delete
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the on-disk session transcript (and its sibling artefacts) when the user deletes a conversation, instead of soft-deleting it via rename.
touchedAreas:
  - electron/main/ipc-handlers.ts
  - electron/api/routes/sessions.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat.ts
  - tests/unit/session-delete-route.test.ts
  - harness/specs/tasks/hard-delete-session-jsonl.md
  - AGENTS.md
expectedUserBehavior:
  - Confirming "Delete" in the sidebar conversation menu removes <id>.jsonl, <id>.deleted.jsonl and any <id>.jsonl.reset.* siblings from the agent's sessions folder.
  - The session entry is removed from sessions.json so OpenClaw sessions.list stops returning it.
  - The sidebar list, sessionLabels and sessionLastActivity for the deleted key are cleared in the renderer store.
  - Token usage history reported by the Dashboard stops including the deleted session.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/session-delete-route.test.ts
  - tests/unit/chat-session-actions.test.ts
acceptance:
  - Renderer continues to use src/lib/host-api.ts and src/lib/api-client.ts; no new direct ipcRenderer or Gateway HTTP calls.
  - IPC channel name session:delete and HTTP route POST /api/sessions/delete are unchanged in shape.
  - Both the IPC handler in electron/main/ipc-handlers.ts and the HTTP mirror in electron/api/routes/sessions.ts unlink the same set of files for a given session id.
  - The handler tolerates ENOENT (file already gone) and still updates sessions.json so the sidebar stops listing the entry.
docs:
  required: true
---

Conversation deletion in ClawX runs entirely on the Main process — the
OpenClaw Gateway does not expose a `sessions.delete` RPC. Historically the
operation was a soft delete: the live `<id>.jsonl` transcript was renamed to
`<id>.deleted.jsonl` so `sessions.list` would skip it. This task replaces
that rename with a true `unlink` plus a sibling sweep that also removes
`<id>.deleted.jsonl` (legacy soft-delete leftovers) and `<id>.jsonl.reset.*`
(reset snapshots produced by `sessions.reset`).

Both backends (the IPC handler used by the refactored chat store and the
HTTP route used by the legacy chat store) share the same disk contract.
Renderer surface is untouched: the confirm dialog in `Sidebar.tsx`, the
`useChatStore.deleteSession` API, and the host-api/api-client boundary all
continue to work without changes. The only user-visible effect is that
deleted conversations no longer leave hidden `.deleted.jsonl` files behind
and no longer contribute to Dashboard token-usage history.

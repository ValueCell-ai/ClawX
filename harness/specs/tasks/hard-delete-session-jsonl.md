---
id: hard-delete-session-jsonl
title: Hard-delete session JSONL on conversation delete
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the on-disk session transcript (and its sibling artefacts) when the user deletes a conversation, instead of soft-deleting it via rename.
touchedAreas:
  - electron/main/ipc-handlers.ts
  - electron/api/routes/sessions.ts
  - electron/utils/session-files.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat.ts
  - tests/unit/session-delete-route.test.ts
  - harness/specs/tasks/hard-delete-session-jsonl.md
  - AGENTS.md
expectedUserBehavior:
  - Confirming "Delete" in the sidebar conversation menu removes <id>.jsonl, <id>.deleted.jsonl and any <id>.jsonl.reset.* siblings from the agent's sessions folder.
  - OpenClaw's trajectory artefacts for the same session id are removed too — both the local <id>.trajectory.jsonl flight recorder and the <id>.trajectory-path.json pointer sidecar.
  - When the pointer's runtimeFile points outside the sessions/ folder (the OPENCLAW_TRAJECTORY_DIR override), that off-disk runtime file is also unlinked so no orphan trajectory remains anywhere on disk.
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
  - Both the IPC handler in electron/main/ipc-handlers.ts and the HTTP mirror in electron/api/routes/sessions.ts unlink the same set of files for a given session id, sharing electron/utils/session-files.ts so the disk contract cannot drift.
  - The handler tolerates ENOENT (file already gone) and still updates sessions.json so the sidebar stops listing the entry.
  - agentId from the sessionKey is validated against /^[A-Za-z0-9][A-Za-z0-9_-]*$/ in both surfaces and any sessionFile resolved to a path outside the agent sessions/ directory is refused (defence-in-depth against a corrupt sessions.json).
  - Absolute-path detection accepts POSIX paths, Windows backslash paths (C:\...) and Windows forward-slash paths (C:/...) so the sweep works on every supported OS.
  - The sweep also unlinks <id>.trajectory.jsonl and <id>.trajectory-path.json sidecars produced by OpenClaw's runtime trajectory writer.
  - When <id>.trajectory-path.json carries the openclaw-trajectory-pointer schema and an absolute .jsonl runtimeFile that lives outside the sessions/ folder, the off-disk runtime trajectory is unlinked too (covers the OPENCLAW_TRAJECTORY_DIR override). Pointers with the wrong schema, a non-.jsonl runtimeFile, or a non-absolute runtimeFile are ignored and no extra files are touched.
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
HTTP route used by the legacy chat store) share the same disk contract via
`electron/utils/session-files.ts`, which centralises:

  - sessions.json entry resolution across the three observed shapes,
  - cross-platform absolute-path detection (POSIX, Windows `C:\...` and
    Windows `C:/...`) using `path.isAbsolute` + `path.win32.isAbsolute`,
  - a defence-in-depth scope check that refuses any `sessionFile` whose
    resolved directory escapes the agent's `sessions/` folder,
  - the sibling sweep (`.jsonl`, `.deleted.jsonl`, `.jsonl.reset.*`,
    `.trajectory.jsonl`, `.trajectory-path.json`) with ENOENT tolerance, and
  - the trajectory pointer-follow that handles OpenClaw's
    `OPENCLAW_TRAJECTORY_DIR` override: when the pointer is well-formed
    (`traceSchema === "openclaw-trajectory-pointer"` and `runtimeFile` is
    an absolute `.jsonl` outside sessions/), the off-disk runtime file is
    unlinked too. Malformed or unsafe pointers are ignored.

Renderer surface is untouched: the confirm dialog in `Sidebar.tsx`, the
`useChatStore.deleteSession` API, and the host-api/api-client boundary all
continue to work without changes. The only user-visible effect is that
deleted conversations no longer leave hidden `.deleted.jsonl` files behind
and no longer contribute to Dashboard token-usage history.

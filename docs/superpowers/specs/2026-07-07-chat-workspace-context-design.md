# Chat Workspace Context Design

Date: 2026-07-07

## Summary

ClawX should let users choose the workspace for new chat sessions from the chat composer footer, then bind that workspace to the OpenClaw session `cwd` once the first message is sent. OpenClaw session `cwd` is the single source of truth for prompt context, the right-side workspace file tree, and sidebar grouping. Historical sessions with a recoverable OpenClaw `cwd` stay grouped under that real directory. Only sessions without recoverable cwd metadata fall back to the default workspace `~/.openclaw/workspace`, displayed as `默认工作空间`.

This design keeps workspace context conversation-owned after first use, while preserving a simple global selection for new sessions.

## Goals

- Add a compact workspace selector pill to the chat footer.
- Use the selected global workspace for new and not-yet-bound sessions.
- Bind the effective workspace to a session on the first sent user message.
- Make bound session workspace read-only in the footer.
- Use the same effective workspace for ACP load, ACP prompt, and the right-side workspace file tree.
- Group session history by workspace first, then by existing recency buckets.
- Display the default workspace path `~/.openclaw/workspace` as `默认工作空间` only when the resolved workspace is the default path.
- Route all new user-facing text through i18n for `en`, `zh`, `ja`, and `ru`.

## Non-Goals

- Do not let users change the workspace of an already-bound historical session.
- Do not silently migrate legacy sessions to an agent workspace when OpenClaw session `cwd` is unavailable.
- Do not add workspace creation, deletion, rename, or file-management features beyond selecting an existing directory.
- Do not add direct renderer IPC calls or direct Gateway HTTP calls.
- Do not change OpenClaw runtime workspace resolution except by passing the intended ACP `cwd` from ClawX.

## Considered Approaches

### Recommended: Session-Bound Workspace Metadata

Use OpenClaw's persisted ACP session `cwd` as the bound workspace for each chat session. New or unbound sessions use the globally selected workspace until the first user message creates or initializes the OpenClaw session with that `cwd`. Historical sessions display the OpenClaw `cwd` read-only and continue to send follow-up prompts from that directory.

This is the safest model because a session's filesystem context remains stable over time and there is one authoritative source for the session/workspace relationship. It matches the desired mixed behavior: global selection is convenient for starting work, while OpenClaw-owned session `cwd` prevents old conversations from accidentally moving to a new cwd.

### Rejected: Global-Only Workspace

A single global workspace could control all chat sessions. This is simpler to build, but reopening an old session after changing the global workspace could send prompts from the wrong directory and show the wrong file tree.

### Rejected: Agent-Derived Workspace

ClawX could continue deriving cwd primarily from the selected agent's workspace. This fits existing code, but it keeps workspace context tied to agent configuration instead of conversation history. It also makes workspace-first sidebar grouping less reliable because sessions can move if agent configuration changes.

## Workspace Model

ClawX should resolve an effective workspace from two concepts:

- `globalWorkspace`: the workspace selected in the footer for new or unbound sessions.
- `sessionWorkspace`: the workspace resolved from OpenClaw's persisted ACP session `cwd`.

Resolution order:

- Existing session with recoverable OpenClaw ACP `cwd`: use that cwd as `sessionWorkspace`.
- New or unbound session: use `globalWorkspace`.
- Session without recoverable cwd metadata: use default workspace `~/.openclaw/workspace`.

The default workspace label is `默认工作空间`. Historical sessions with a real recovered cwd should be grouped and displayed under that cwd, not forced into the default group. Any path display should still expose enough information to distinguish non-default workspaces, using existing path-shortening conventions such as replacing the home directory with `~` where appropriate.

## UI Components

### Chat Footer Selector

Add a compact workspace pill in the `ChatInput` footer near the existing connection/status text. The selected visual direction is the compact footer pill, not a dedicated extra row.

For new and unbound sessions, the pill opens a selector for choosing an existing workspace directory. For bound sessions, the pill is read-only and displays the bound workspace. The read-only state should be visually clear without feeling disabled or broken.

### Chat Page Coordination

`Chat/index.tsx` should own or derive the effective workspace and pass it consistently to:

- `ChatInput` for display and selection state.
- ACP session load.
- ACP prompt/send.
- The right-side artifact/workspace panel.

Renderer code should not keep separate cwd derivation paths for these consumers.

### Right Workspace Tree

The workspace browser should use the same effective workspace root as the chat session. It should no longer be scoped only to the selected agent workspace when a session-bound or globally selected workspace is available.

### Sidebar History

Sidebar session history should group sessions by workspace first, then by the existing recency buckets inside each workspace group. The legacy/default group uses the `默认工作空间` label.

## Data Flow

### New Session

1. Footer displays `globalWorkspace`.
2. User may change `globalWorkspace` before sending the first message.
3. On the first sent message, ClawX binds the effective workspace to the session.
4. ACP load and prompt paths receive that workspace as `cwd`.
5. The right workspace tree uses the same workspace root.
6. Sidebar places the session under that workspace group.

### Existing Bound Session

1. ClawX reads the stored session workspace metadata.
2. Footer displays the workspace read-only.
3. ACP follow-up prompts use the stored workspace as `cwd`.
4. Changing the global workspace elsewhere does not affect the session.

### Session Without Recoverable Cwd

1. If OpenClaw does not expose recoverable cwd metadata, ClawX treats the session as default-workspace history.
2. Footer and sidebar display `默认工作空间`.
3. Follow-up prompts use `~/.openclaw/workspace` as `cwd`.

## Persistence And Boundaries

Global workspace and recent workspace choices should be persisted through Main-owned host APIs and existing app settings patterns. Renderer code must use `src/lib/host-api.ts` and `src/lib/host-api-client.ts` rather than adding direct IPC calls.

OpenClaw ACP session metadata is the authoritative storage for session workspace binding when it exists. OpenClaw already persists ACP session `cwd` in its SQLite-backed `acp_sessions` metadata during session initialization and reads it back through the ACP session metadata helpers. ClawX should therefore not create a duplicate primary mapping of session id to workspace path.

Implementation should first expose or consume OpenClaw's persisted ACP `cwd` through ClawX's existing host-api/api-client boundary so renderer session summaries and ACP chat restoration can resolve the workspace from the same source. If an existing OpenClaw/Gateway projection does not currently include ACP `cwd`, the implementation should add the minimal projection or host-api read needed to surface it.

ClawX-local supplemental metadata should be avoided. It is only allowed as a narrow fallback for ClawX-created sessions when OpenClaw cannot yet return a workspace for that session. If used, it must be scoped to session key and workspace path, and OpenClaw ACP `cwd` takes precedence whenever both sources are present.

Prompting should continue to pass workspace through the existing ACP `cwd` fields. ClawX should not make workspace visibility depend on visible prompt text, and should preserve the current behavior that avoids injecting an obvious cwd prefix into the user-visible transcript.

## Error Handling

- If the selected path no longer exists, keep showing the stored workspace and mark it unavailable in selector or file-tree state.
- The file tree should show an empty/error state for missing or unreadable workspace paths, not silently fall back to another directory.
- ACP send should pass the intended `cwd`; if the runtime rejects or cannot use it, surface the existing send/runtime error.
- If persisting the global workspace fails, show a non-blocking error and keep the previous global workspace.
- If binding session workspace metadata fails on first send, show a non-blocking error and avoid presenting the session as successfully bound to a different path.
- Invalid or empty workspace paths should be rejected before becoming global or session-bound values.

## i18n And Styling

All new user-facing strings must live in the existing locale files under `shared/i18n/locales/<lang>/` with coverage for `en`, `zh`, `ja`, and `ru`.

The selector should use existing design tokens and component conventions from `src/styles/globals.css`. Use selected-state tokens such as `bg-black/5 dark:bg-white/10`, existing surface tokens for popovers or inputs, and status colors from the documented token set.

## Testing

Add unit tests for workspace resolution:

- Bound sessions use `sessionWorkspace`.
- New and unbound sessions use `globalWorkspace`.
- Historical sessions with recovered OpenClaw ACP `cwd` use that cwd and display the corresponding workspace label/path.
- Sessions without recoverable cwd metadata use `~/.openclaw/workspace` and display `默认工作空间`.

Add unit tests for sidebar grouping:

- Sessions group by workspace before recency bucket.
- Historical sessions with recovered cwd appear under their real cwd workspace group.
- Sessions without recoverable cwd appear in the default workspace group.
- Existing recency bucket behavior is preserved within each workspace group.

Add or update host/API tests where practical for:

- Persisting global workspace.
- Reading or writing session workspace metadata.

Add Electron E2E coverage for the visible flow:

- Workspace selector is visible in the chat footer.
- New session workspace selection updates the right workspace tree root.
- First send binds the session workspace.
- Historical bound session shows the footer selector read-only.
- Legacy/default workspace displays as `默认工作空间`.

## Documentation

After implementation, review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. Update them only if the workspace selector changes documented user flows or troubleshooting guidance.

## Validation

Expected validation after implementation:

- `pnpm run typecheck`
- Targeted unit tests for workspace resolution and sidebar grouping
- Targeted Electron E2E spec for the workspace selector/session-binding flow
- `pnpm run build:vite`

Because this change touches ACP load/send `cwd` paths, also run:

- `pnpm run comms:replay`
- `pnpm run comms:compare`

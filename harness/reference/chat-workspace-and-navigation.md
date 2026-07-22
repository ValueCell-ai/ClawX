# Chat Workspace And Navigation

Status: current workspace reference, reviewed 2026-07-13.

Related scenario: `chat-workspace-and-navigation`

Related rules: `session-workspace-authority`, `ui-i18n-design-tokens`

Related task: `chat-workspace-context`

## Workspace Authority

OpenClaw's persisted ACP `cwd` is authoritative for a bound session. The global workspace is only the default for a new or not-yet-bound session. Resolution is:

1. Recoverable session `workspacePath` projected from OpenClaw ACP metadata.
2. Global workspace for a new or local unbound session.
3. `~/.openclaw/workspace` when a historical session has no recoverable cwd.

The effective workspace is shared by ACP load/prompt, the composer, sidebar grouping, the right-side workspace browser, and tool-derived file activity. A bound session is read-only in the composer and is not moved when the global selection changes. Missing or unreadable bound paths show unavailable/error state instead of silently changing roots.

ClawX persists global and recent workspace selections plus custom display labels through Main-owned settings APIs. On editable new or unbound chats, the composer menu shows the canonical default once, followed by deduplicated non-default workspaces from the most-recent list and known session paths, then the native folder picker. Recent entries stay first; all entries use custom display labels when available, keep the full path as hover text, and update only the global selection until first send binds the session. Custom labels are keyed by canonical path and never replace path identity or ACP cwd authority. Renderer session state may mirror the bound path for UI coordination, but must not become a competing persistent session-to-path authority. Targeted `@agent` sends intentionally use the target agent workspace and remain an explicit branch. Navigation records that workspace on the target session placeholder before reactive loading; a newly targeted agent's first send creates its main ACP session and shares one load identity with the prompt so navigation cannot supersede delivery.

## First Send And Titles

First send initializes the ACP session with the selected cwd and then marks the local session as created/bound. ACP keeps `_meta.prefixCwd: true`; disabling cwd injection would break OpenClaw context. Automatic titles instead normalize away one leading `[Working directory: ...]` envelope and subsequent whitespace.

Normalization applies to automatic sources such as Gateway-derived title and Main transcript summary. It never changes an explicit user label, never removes a non-leading marker, and treats the exact truncated envelope form as a missing title so a better summary can replace it. OpenClaw's synthetic `<first 8 session UUID characters> (YYYY-MM-DD)` fallback is also treated as missing only when it matches the row's full session id; Main's transcript summary then supplies the first user prompt. Opening and closing rename mode without changing the value must not persist any displayed fallback as an explicit label.

## Sidebar Navigation

Sessions are grouped by workspace, not by date bucket. The default workspace sorts first and other workspace labels use natural ordering. Within a group, activity sorts descending using:

1. Hydrated session last activity.
2. Summary `updatedAt`.
3. Timestamp parsed from the session key.
4. Zero.

Each group initially displays five sessions and loads five more at a time. Collapse and visible-count state are per workspace and in memory. Relative time and ordering use the same timestamp; actions replace the timestamp on hover or keyboard focus.

Non-default workspace headers expose a rename action on hover or keyboard focus. A custom name updates both the sidebar group and the composer workspace chip; the header and chip keep the full filesystem path in their title text.

Sidebar validates distinct non-default group paths through Main. A confirmed unavailable group shows a warning badge and destructive delete action; available, unresolved, and default groups do not. One confirmation hard-deletes the group's sessions sequentially across agents. Successful sessions disappear together, failed sessions remain for retry, and workspace recents/labels are removed only after the full group succeeds.

## Workspace Browser

The right panel tabs remain Workspace, Preview, and Changes. The Workspace tree uses `react-arborist`, includes hidden files, uses relative path as node identity, and remains read-only: no edit, drag/drop, or multi-select. Agent and path tags replace the older `Workspace - agent` header. Home is compacted to `~`, the path's final segment remains visible, and the full value is available as a title.

File icons come only from trusted bundled assets. Selecting a file preserves the existing preview behavior and backend boundary.

## Question Navigation

The Chat question directory belongs to the active ACP timeline rather than workspace persistence. Its current behavior is documented in `harness/reference/acp-chat.md`.

## Validation Anchors

Key tests include `tests/unit/workspace-context.test.ts`, `tests/unit/session-title.test.ts`, `tests/unit/session-buckets.test.ts`, `tests/unit/sidebar-session-buckets.test.ts`, `tests/unit/workspace-browser-body.test.tsx`, `tests/unit/chat-acp-page.test.tsx`, recent-workspace selection coverage in `tests/e2e/chat-workspace-context.spec.ts`, `tests/e2e/chat-acp-inline-timeline.spec.ts`, and `tests/e2e/chat-question-directory.spec.ts`.

This reference consolidates the former workspace sidebar, chat workspace context, sidebar workspace UI, and ACP working-directory title designs. The later flat activity-sorted sidebar supersedes the earlier recency buckets.

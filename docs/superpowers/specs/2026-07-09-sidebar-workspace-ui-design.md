# Sidebar And Workspace UI Design

## Context

ClawX currently groups sidebar chat sessions by workspace and then by date buckets such as today and last 7 days. The chat composer shows workspace selection in the footer, and the workspace browser panel renders the current agent and directory as a single text title. This design updates those areas to reduce visual clutter and make workspace context easier to scan.

## Goals

- Keep sidebar sessions grouped by workspace, but remove date bucket grouping.
- Add global and per-workspace collapse controls for the session list.
- Show a small, always-visible relative updated/activity time for each session until hover reveals row actions.
- Improve workspace group header typography so workspace names no longer look visually subordinate to session titles.
- Make workspace group ordering stable: default workspace first, all other workspaces naturally sorted by label/path.
- Replace the workspace browser's plain text title with compact tags for agent and path.
- Move composer workspace selection to the left side of the footer, with gateway status right-aligned.
- Use a dropdown menu for editable workspace selection, with a default workspace option and a directory picker option.

## Non-Goals

- Do not change how session workspace ownership is resolved from OpenClaw/ACP metadata.
- Do not change the existing native directory picker implementation beyond moving it behind a menu option.
- Do not change session deletion, renaming, or switching semantics.
- Do not introduce broad sidebar refactors unrelated to this UI change.

## Sidebar Session List

The expanded sidebar will render a new title row above workspace groups:

- Title text: `chat:sessionList.title` (`会话列表` in zh).
- Right action button toggles all workspaces between collapsed and expanded.
- The button uses a suitable visible icon instead of visible text. Its accessible label/title switches between `chat:sessionList.collapseAll` and `chat:sessionList.expandAll`.

Each workspace group will render as a collapsible section:

- The workspace header row includes a chevron, the workspace label, and optional count text if useful for clarity.
- The workspace label should use a stronger, more balanced style than today: close to session-title scale, medium weight, muted but readable color, and enough vertical spacing to visually anchor the group.
- Clicking the workspace header toggles only that workspace.
- The default collapsed state is expanded.
- The global collapse button writes workspace-level collapsed state for all visible workspace groups.

Date buckets (`today`, `withinWeek`, `withinMonth`, `older`) will be removed from rendering. The grouping helper will instead produce workspace groups with a flat `sessions` array sorted by activity descending.

Each workspace group displays at most 5 sessions initially. Clicking `chat:sessionList.loadMore` displays 5 additional sessions for that workspace. The visible count is tracked per workspace path. If no hidden sessions remain, the load-more button is not rendered.

Session rows keep current switching, double-click rename, edit, and delete behavior. The normal row state shows a right-aligned relative updated/activity time label from `timeago.js`. On row hover or focus-within, the relative time is hidden and the existing rename/delete controls are shown. While a session is being renamed, the edit form replaces the row content as it does today.

## Sidebar Ordering

Workspace groups are sorted deterministically:

- Default workspace group always comes first.
- Other groups sort with natural string comparison using their display label, falling back to normalized workspace path.

Within each workspace, sessions remain sorted by activity descending. Activity uses the current priority order:

- `sessionLastActivity[session.key]`
- `session.updatedAt`
- timestamp embedded in `session-*` key
- `0` when no source exists

## Relative Time

Add `timeago.js` as a dependency. Use `format(value, locale, { relativeDate })` from `timeago.js` for deterministic formatting in tests and live formatting in the UI.

The displayed relative time may use the same activity timestamp that drives session ordering. This keeps implementation simple and aligns the label with the “latest sessions” behavior. Activity uses the existing priority order: message activity, then `updatedAt`, then timestamp embedded in `session-*` keys, then `0`.

Locale mapping:

- `en` -> default / `en_US`
- `zh` -> `zh_CN`
- `ja` -> `ja`
- `ru` -> `ru`

Specific locale files are registered once in a small utility, avoiding the full all-locale build. The sidebar already ticks `nowMs` once per minute; that timestamp will be passed as `relativeDate` so visible labels refresh predictably.

## Workspace Browser Header

The workspace browser body header will replace the combined `workspace.header` string with two tag-like inline components:

- Agent tag: shows the current agent display name, for example `Main Agent`.
- Path tag: shows the effective workspace label/path.

The path tag must stay on one line. The final path segment is the most important part and must not be truncated. The leading path portion may shrink and use a leading-side ellipsis style so the final segment remains visible.

Example visual structure:

```text
[ Main Agent ] [ ~/workspace/ clawx-playground ]
```

In the path tag, the final segment uses foreground text and semibold weight. The preceding path portion uses muted text. Dark mode uses the existing foreground/muted tokens so the final segment appears white and the preceding path appears gray.

The header keeps a full `title` attribute containing the agent and absolute/effective workspace path.

## Composer Footer Workspace Selector

The composer footer layout changes from a single left status cluster to two sides:

- Left side: workspace control, when workspace label/path are available.
- Right side: gateway status, extension composer status components, and retry failed attachments action.

Editable sessions render the workspace control as a button that opens a small menu above the composer:

- `chat:composer.defaultWorkspaceOption`: selects `DEFAULT_WORKSPACE_CWD` via `onSelectWorkspace(DEFAULT_WORKSPACE_CWD)`.
- `chat:composer.chooseOtherWorkspaceOption`: opens the existing native directory picker. If a directory is selected, pass it to `onSelectWorkspace(selectedPath)`.

Read-only bound sessions render a non-interactive workspace chip for context. It does not open a menu and remains marked disabled for accessibility. This matches the approved option B from brainstorming.

Opening any workspace menu should close the existing agent, skill, and model pickers to avoid overlapping popovers. Opening other composer pickers should close the workspace menu.

Gateway status remains right-aligned relative to the input box.

## I18n

New user-facing text must be added to all chat locale files under `shared/i18n/locales/{en,zh,ja,ru}/chat.json`.

New keys:

- `sessionList.title`
- `sessionList.collapseAll`
- `sessionList.expandAll`
- `sessionList.loadMore`
- `sessionList.workspaceToggle`
- `composer.defaultWorkspaceOption`
- `composer.chooseOtherWorkspaceOption`

Existing `workspace.header` can remain for compatibility but will no longer be used by the workspace browser header.

## Tests

Unit tests:

- Update session grouping tests to assert default workspace first and natural ordering for other workspaces.
- Assert groups contain flat session arrays sorted by activity descending and row relative-time labels use the same activity timestamp.
- Update sidebar-specific tests for workspace test IDs and remove date-bucket expectations.
- Update `chat-input.test.tsx` for workspace menu behavior, default workspace selection, choose-other-directory behavior, read-only chip behavior, and right-aligned gateway status where practical.
- Update `workspace-browser-body.test.tsx` to assert agent/path tags and final path segment styling/visibility behavior.

E2E tests:

- Replace date-bucket E2E expectations with workspace grouping, load-more, and collapse/expand behavior.
- Update chat workspace context E2E for the composer dropdown if it interacts with workspace selection.
- Keep right workspace panel E2E coverage by asserting agent and path tag content instead of the old combined text.

Validation commands:

- Targeted Vitest files for updated components.
- `pnpm run typecheck`.
- File-scoped ESLint for touched files.
- Relevant Electron E2E specs for sidebar/session and workspace context.

Full `pnpm run lint:check` may still be blocked by existing unrelated `AcpToolCallCard.tsx` React Compiler lint errors unless they are separately fixed.

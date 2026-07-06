# Workspace Sidebar Design

## Scope

Update the right-side artifact panel workspace tab only. Keep the existing workspace loading, preview rendering, file read safety, refresh, and reveal-in-file-manager behavior intact.

## User-Visible Behavior

- Artifact panel tabs appear in this order: Workspace, Preview, Changes.
- The workspace tree always includes hidden files and folders.
- The hidden-file toggle is removed.
- The tree area no longer repeats the `Workspace · <agent>` label.
- The panel header keeps `Workspace · <agent>` and adds the current workspace path on the right side of that title group.
- Workspace paths are shown with the user home directory compressed to `~` when applicable. Long paths truncate visually and expose the full path through `title`.
- Files use material-style file icons from `material-file-icons`.

## Architecture

- `ArtifactPanel` owns tab ordering and still renders the same three tab bodies.
- `WorkspaceBrowserBody` keeps its current data loading and preview panes.
- The manual recursive `FileTreeNodeList` and `FileTreeNodeRow` implementation is replaced with `react-arborist`.
- The tree uses existing `WorkspaceTreeNode` data directly, with `relPath` as the node id.
- `react-arborist` is configured as read-only: editing, dragging, dropping, and multi-selection are disabled.
- Selection remains controlled by `selectedRel`; activating a file sets `selectedRel`, and activating a directory toggles it.

## Icons

- Add a small React wrapper around `material-file-icons` `getIcon(filename).svg` for file rows and selected-file headers.
- Directory rows use folder chevrons/icons for clear expand/collapse state.
- SVG insertion is limited to trusted bundled icon SVG returned by the library.

## Data Flow

- `loadWorkspaceTree(workspace, { includeHidden: true, runStartedAt })` becomes the default workspace tree load path.
- `showHidden` state and toggle handlers are removed.
- Existing `findNode`, preview loaders, rich document handling, large/binary fallback, and file manager actions are unchanged.

## i18n And Styling

- Keep all visible strings under the existing `chat` namespace for `en`, `zh`, `ja`, and `ru`.
- Remove or stop referencing hidden-file action labels.
- Use current design tokens for selected and hover states: selected rows use `bg-black/5 dark:bg-white/10`, muted metadata uses existing muted foreground classes.

## Testing

- Update unit tests for tab order and workspace behavior.
- Update `WorkspaceBrowserBody` tests so tree rows still select files after the Arborist refactor.
- Add or update Electron E2E coverage for:
  - Workspace tab appears before Preview and Changes.
  - Hidden-file toggle is absent.
  - Header displays the agent and `~`-compressed workspace path.

## Non-Goals

- Do not add editing, rename, drag/drop, context menus, search, or file creation.
- Do not change backend file APIs or renderer/Main communication boundaries.
- Do not change the file preview behavior outside the workspace tree UI.

# OpenClaw File Activity Hydration Design

Date: 2026-07-12

## Summary

ClawX will restore Chat file buttons and file-change UI by projecting successful OpenClaw file-editing tool calls from the ACP timeline. The projection recognizes the same three tools as OpenClaw's official Chat UI: `write`, `edit`, and `apply_patch`.

The feature is intentionally a record of tool-declared file activity, not a verified filesystem diff. It does not scan the workspace, require Git, create snapshots, or claim to detect shell and script side effects. ClawX adds one intentional difference from the official UI: failed tool calls are excluded.

The resulting UI has two scopes:

- Each assistant turn shows the files and change fragments reported by successful supported tools in that turn.
- The right-side Changes tab is session-scoped, groups activity by file, and preserves chronological fragment order within each file. A new session with no qualifying activity explicitly shows that the session has no file changes.

## Context

The ACP-native Chat migration removed two pre-existing ClawX affordances:

- A per-turn file-change block with file path, action, and added/removed line counts that opened the right-side Changes view.
- File buttons attached to assistant output that opened the right-side Preview view.

The old ClawX implementation parsed tool-call arguments and sometimes captured an in-memory pre-write baseline. It was not connected to the ACP timeline after the migration.

OpenClaw's official Chat UI now exposes a session Workspace rail and an `x changed` count through `sessions.files.list`. Its backend scans the session transcript and classifies paths mentioned by `write`, `edit`, and `apply_patch` as modified. It does not use Git, take a source snapshot, verify tool success, or render a before/after diff.

The current `openclaw acp` bridge provides enough information for ClawX to render richer tool-declared activity:

- Tool start updates include `title`, `rawInput`, `kind`, and `locations`.
- Tool result updates include `status`, `rawOutput`, textual content, and locations.
- OpenClaw formats titles as `<toolName>: <arguments>`.
- OpenClaw records these updates in its ACP replay ledger.

OpenClaw does not currently emit standard ACP structured diff content for Gateway file tools. `extractToolCallContent()` maps tool results only to textual ACP content blocks. ClawX must therefore derive change fragments from the supported tools' canonical `rawInput` shapes.

## Goals

- Restore per-turn file buttons for files handled by successful OpenClaw file-editing tools.
- Restore per-turn file-change summaries with tool-declared action and line counts.
- Provide a session-level Changes view grouped by file, with each file's collected change fragments in chronological order.
- Keep the recognized tool set aligned with OpenClaw's official Chat UI.
- Exclude failed tool calls from all file activity UI.
- Restore file activity from normal ACP replay when replay includes the required tool title, status, and raw input.
- Reuse the existing right-side Preview and Changes panel and existing file renderers where their semantics fit.
- Keep filesystem access behind typed Main-owned host APIs.
- Work without a Git repository or an installed Git executable.

## Non-Goals

- Do not scan or watch the workspace.
- Do not create before/after source snapshots.
- Do not detect changes made by shell commands, scripts, unknown tools, the user, an IDE, or another process.
- Do not verify that a tool-declared edit matches the final bytes on disk.
- Do not produce a net session diff relative to a source baseline.
- Do not call `sessions.files.list` to manufacture diffs that its contract does not contain.
- Do not parse arbitrary assistant prose or Markdown code spans as local file activity.
- Do not implement generic compatibility for arbitrary ACP agents or file-tool schemas.
- Do not modify OpenClaw source.
- Do not add a ClawX-owned persisted activity ledger.
- Do not revive the legacy Execution Graph.

## User-Facing Semantics

The feature represents:

> File changes reported by successful OpenClaw file-editing tool calls in this session.

It does not represent:

> The current workspace compared with Git, disk state at session start, or a verified filesystem baseline.

UI labels, empty states, documentation, and code comments must preserve that distinction. The visible UI can use the concise labels File Changes and Changes, but explanatory copy and unavailable states must not claim that the result is a verified workspace diff.

## Chosen Architecture

File activity is a pure Renderer projection over the existing `AcpTimelineSnapshot`.

```text
OpenClaw Gateway tool event
  -> openclaw acp session/update
  -> Main ACP routing envelope
  -> existing Renderer ACP reducer
  -> OpenClaw file-activity selector
  -> per-turn file UI and session-level Changes tab
```

Main remains responsible for ACP process and transport ownership. It does not interpret tool semantics or build file activities. The existing ACP reducer continues to retain tool title, status, raw input, raw output, locations, and historical markers.

The selector derives file activity from the timeline on demand. It does not persist a second copy of Chat history. Live updates and replay therefore follow the same reduction and projection path.

## OpenClaw Compatibility Boundary

### Tool identity

Standard ACP tool calls do not expose a dedicated tool-name field. OpenClaw's ACP bridge uses `formatToolTitle()` to produce a title whose first colon-delimited segment is the original tool name.

The selector will:

1. Read the title segment before the first colon.
2. Trim and lowercase it.
3. Accept only the exact names `write`, `edit`, and `apply_patch`.

Titles without a valid supported prefix are ignored. This parsing is an OpenClaw compatibility dependency, not a generic ACP guarantee, and must have regression coverage against the distributed OpenClaw behavior.

### Deliberate difference from official Chat UI

OpenClaw's `sessions.files.list` counts a recognized tool path without checking whether the tool succeeded. ClawX will require the reduced ACP tool status to be `completed`.

The design and implementation must describe this accurately:

- Tool recognition and path aliases align with the official OpenClaw Chat UI.
- Success filtering is a deliberate ClawX enhancement.

### No structured ACP diff dependency

The projection will not depend on or add support for standard ACP structured diff content in this implementation. Current OpenClaw Gateway tool updates do not emit it. The projection will not parse `rawOutput` or textual tool output for changes.

## Data Model

Use a dedicated model so tool-declared activity is not confused with the legacy `GeneratedFile` model's baseline semantics.

```ts
type OpenClawFileToolName = 'write' | 'edit' | 'apply_patch';

type AcpFileChangeFragment = {
  oldText: string;
  newText: string;
  sequence: number;
};

type AcpFileActivity = {
  turnId: string;
  toolCallId: string;
  toolName: OpenClawFileToolName;
  relativePath: string;
  action: 'created' | 'modified' | 'deleted';
  fragments: AcpFileChangeFragment[];
  sequence: number;
};

type AcpTurnFileSummary = {
  turnId: string;
  relativePath: string;
  action: 'created' | 'modified' | 'deleted';
  activities: AcpFileActivity[];
  added: number | null;
  removed: number | null;
};
```

`sequence` is derived from ACP timeline and fragment order. It is used only for deterministic rendering and must not be treated as persisted protocol identity.

## Turn Association

The selector must use the existing ACP timeline grouping rules rather than define a second conversation-segmentation algorithm.

Each supported tool call belongs to the assistant turn/display group in which the current timeline grouping logic places it. The per-turn file UI renders once for that group. Replay and live updates must produce the same grouping for the same ordered timeline.

Every qualifying tool call must belong to an assistant-turn display group, including tool-only groups with no assistant prose. The implementation must preserve the existing timeline position for such a group rather than place its file button under an unrelated message.

## Raw Input Extraction

Only OpenClaw's supported raw input shapes are parsed. The implementation must not restore the old broad, multi-agent alias normalizer.

### Shared path fields

For `write` and `edit`, path lookup follows the official `sessions.files.list` order:

1. `path`
2. `file_path`
3. `filePath`
4. `file`

The first non-empty string is used.

### `write`

The canonical payload is a path plus string `content`.

ClawX intentionally renders every successful valid Write as a creation:

```text
oldText = ""
newText = rawInput.content
action = created
```

The resulting diff is all additions and the summary displays `+N -0`. This is a tool-payload display convention and does not assert that the file was absent before execution.

If `content` is absent or not a string, the path still produces a file button and a created summary row, but no diff fragment or line count is available.

### `edit`

The canonical payload is a path plus:

```ts
edits: Array<{ oldText: string; newText: string }>
```

OpenClaw also accepts a legacy single-edit shape with top-level `oldText` and `newText`; ClawX will support that official compatibility form.

Each valid old/new pair becomes a separate fragment in array order. Invalid entries are skipped. If no valid pair remains, the path still produces a modified summary row and file button with no available diff.

No `old_string`, `new_string`, arbitrary before/after aliases, or unrelated agent schemas are supported.

### `apply_patch`

The canonical payload contains string `input` in OpenClaw's patch format. Parsing is limited to these official markers:

```text
*** Add File: <path>
*** Update File: <path>
*** Delete File: <path>
*** Move to: <path>
```

Behavior:

- Add File produces a created activity. Added patch lines form an empty-to-new fragment.
- Update File produces a modified activity. Removed and added hunk lines form old/new fragments in patch order.
- Delete File produces a deleted activity. If the patch carries no old text, the activity has no fragment or line count.
- Move to produces a deleted activity for the Update File source and a created activity for the destination. Extracted update fragments are associated with the destination. If both paths normalize to the same relative path, the result is one modified activity instead.

The parser implements the accepted OpenClaw grammar in `src/agents/apply-patch.ts`, rather than a generic patch format:

- Input is trimmed and split with LF or CRLF handling.
- The patch may be wrapped by `<<EOF`, `<<'EOF'`, or `<<"EOF"` plus a closing line ending in `EOF`; the wrapper is removed before envelope validation.
- After optional wrapper removal, the first and last trimmed lines are `*** Begin Patch` and `*** End Patch`.
- A file section begins with exactly one Add, Update, or Delete marker.
- Add body lines use the `+` prefix.
- Delete sections have no body and do not invent old content.
- An Update section may contain `*** Move to:` only immediately after its Update header.
- The first Update chunk may omit an `@@` context marker; later chunks require `@@` or `@@ <context>`.
- Update body lines use space for context, `-` for removed text, and `+` for added text. An empty physical line is an empty context line, matching OpenClaw's parser.
- `*** End of File` marks the end of an Update chunk and is not file content.

Because only completed tool calls are projected, the input should already have passed OpenClaw's atomic patch validation. ClawX must parse the entire canonical payload atomically as well. If parsing fails, it produces no activity for that tool call rather than returning partial or permissively recovered records. Compatibility tests must use valid payloads from OpenClaw's apply-patch implementation, including wrappers and a first Update chunk without `@@`.

## Path Resolution And Security

Tool-provided paths are untrusted.

Path resolution distinguishes the containment root from the tool execution directory:

- `workspaceRoot` is the effective workspace bound to the current ClawX session and is the containment boundary.
- `executionCwd` is the cwd supplied by ClawX to ACP `session/load` and `session/prompt` for that timeline.
- In the current ClawX workspace model these values are normally the same path, but the projection must not assume that permanently.
- Relative tool paths resolve against `executionCwd`, then must remain inside `workspaceRoot` after normalization.
- Absolute tool paths must already be inside `workspaceRoot`.
- If replay cannot be associated with both an authoritative workspace root and execution cwd, ClawX does not project file activity for that replay.

Filesystem reads for generated file buttons must use workspace-scoped Main APIs. The request carries a workspace root plus relative path; Main canonicalizes the root and target, rejects parent traversal and symlink escape, and performs only read/stat operations inside the root.

The two validation stages have distinct behavior:

- Renderer lexical validation determines whether an activity and button are rendered. A lexical path outside the workspace produces no UI.
- Main canonical validation occurs when the user requests Preview. A lexically valid path whose real target escapes through a symlink remains visible as a historical tool activity, but the filesystem operation is rejected and the UI shows localized file-unavailable feedback.

Renderer components must not turn tool paths into direct `file://` navigation, direct filesystem reads, or unscoped shell operations.

The scoped contract uses a relative reference end to end:

```ts
type WorkspaceFileRef = {
  workspaceRoot: string;
  relativePath: string;
};

files.readWorkspaceText(
  ref: WorkspaceFileRef,
): Promise<ReadTextFileResult>;

files.readWorkspaceBinary(
  input: WorkspaceFileRef & { maxBytes?: number },
): Promise<ReadBinaryFileResult>;

files.statWorkspaceFile(
  ref: WorkspaceFileRef,
): Promise<StatFileResult>;

```

These methods reuse the existing text/binary size limits, MIME metadata, missing-file errors, and preview result semantics. Each method independently canonicalizes and validates the target at operation time. For a missing leaf, Main validates its nearest existing parent before returning `notFound`. No method returns an unvalidated absolute path to Renderer.

Tool-derived `FilePreviewTarget` values carry `WorkspaceFileRef`. `FilePreviewBody` and rich preview renderers select these scoped methods whenever that reference is present. Tool-derived targets are read-only in-app previews and expose no system open or reveal action, including rich-document toolbars and too-large or unsupported fallbacks. Electron's OS shell APIs accept paths rather than validated file handles, so validation and shell dispatch cannot be made atomic against a symlink swap. Existing trusted preview callers without `workspaceFileRef` retain their current unscoped open and reveal behavior.

## Deduplication And Aggregation

Tool calls are keyed by ACP `toolCallId`. Repeated initial/update/replay delivery patches one reducer item and must not duplicate activity.

Within one turn:

- A relative path has one file button.
- A relative path has one summary row.
- All successful activities and fragments for that path are retained in chronological order.
- Summary line counts are the sum of available fragment diffs.
- If no fragment has countable text, added and removed are `null` and the UI omits `+/-`.

The summary action follows the ordered tool intent rather than disk state. Creation followed by edits remains created. A final deletion is deleted. Deletion followed by creation is created. For an apply-patch Move whose normalized source and destination resolve to the same relative path, ClawX emits one modified activity rather than a delete/create pair.

Across the session:

- Earlier fragments are not overwritten by later activity on the same path.
- The Changes tab groups by relative path. File groups are ordered by their first activity and turn records are chronological within each group.
- Original tool activities and fragments remain available to the projection, but the UI renders at most one diff editor per turn and path.
- Sequential fragments compose when the previous new text exactly matches the next old text. A known complete created document may also replay a later uniquely matching replacement. Exact duplicate pairs are omitted. Remaining independent fragments are concatenated into one display pair in chronological order.
- The view is a change record, not a session-wide composed or directly applicable cumulative patch.
- Session-level file count is the number of unique eligible paths represented by successful supported tool calls.

Line counts reuse ClawX's existing diff semantics: normalize CRLF to LF, compare each fragment with `diffLines`, and sum only added and removed pieces. Empty text has zero logical lines; a trailing newline does not create an extra logical line. Context-only patch lines do not contribute to `+/-`.

## User Experience

### Per-turn file buttons

Every unique eligible file path from a successful supported tool call produces a file button in that assistant turn.

- Created and modified files open the right-side Preview tab and read the current file through the scoped host API.
- Deleted files remain represented, but selecting their file button opens the right-side Changes tab at the deletion record.
- If a created or modified file no longer exists, Preview uses the existing missing-file state; its recorded tool fragments remain available in Changes.

### Per-turn file changes

Each turn with qualifying activity shows a File Changes block containing one row per unique path:

- Relative path
- Tool-intent action: created, modified, or deleted
- Added/removed line counts when fragments provide countable text

Selecting a row opens the session-level Changes tab, focuses that path, and scrolls to the selected turn's first activity for it.

No block is rendered for turns without qualifying successful activity.

### Session-level Changes tab

Changes is a session-level tab, not a current-turn tab.

- It shows the unique file count for the current session.
- It groups records by file path.
- Each file shows ordered turn records, with one diff editor per turn and file.
- Safe sequential edits display the first old text against the final new text. Independent snippets share one editor and do not claim to represent a complete-file baseline.
- It does not claim to show a net diff against session start or current disk.
- When the selected session has no qualifying activity, including on the New Session page before the first successful file tool call, it explicitly displays the localized empty state: `This session has no file changes yet.` / `本会话尚无文件变更`.
- The empty state replaces generic no-diff wording for a session with no records.

### Relationship to Preview and Workspace

Preview continues to display the current on-disk file, not tool input content. Changes displays the recorded tool-declared fragments. The Workspace browser remains a filesystem browser and is not used to infer change activity.

## Replay And Lifecycle

The projection is derived from the active ACP timeline and is not persisted by ClawX.

- Live completed tool calls appear when their reducer status becomes completed.
- Full OpenClaw ACP replay restores file buttons and change records from replayed title, status, and raw input.
- Historical sessions whose fallback replay contains only user/assistant prose do not receive reconstructed file activity.
- Session switch clears the active rendered projection with the timeline and derives the destination session's projection after load.
- A New Session timeline starts with an empty session-level Changes state.
- Normal OpenClaw session deletion requires no additional artifact cleanup in ClawX.

## Error Handling

- Unsupported or malformed title: ignore the tool call.
- Pending, running, or failed status: do not project file activity.
- Missing or malformed raw input: ignore paths that cannot be identified; retain a path-only record when an official path can be identified but diff content is unavailable.
- Invalid or out-of-workspace path: ignore the candidate.
- Apply-patch parse failure: produce no activity for that tool call; do not emit partial path-only records.
- Missing current file: keep recorded fragments; Preview shows the existing missing state.
- Scoped host validation failure: retain the historical activity, do not read, open, or reveal the file, and show localized file-unavailable feedback.
- Duplicate update or replay event: reducer/tool-call identity prevents duplicate activity.

File activity failures must not affect prompt sending, ACP reduction, tool-card rendering, or the final assistant response.

## Components And Integration Points

Expected implementation areas:

- `src/lib/acp/openclaw-file-activities.ts`: title parsing, canonical raw-input parsing, path normalization, turn/session projection, aggregation, and line statistics.
- `src/lib/acp/timeline-groups.ts`: reuse existing grouping output; change only if a stable turn identity must be exposed.
- `src/pages/Chat/index.tsx`: replace the current path-only ACP generated-file derivation with the selector output and wire session-level activity to the artifact panel.
- `src/pages/Chat/AcpAssistantTurn.tsx`: render per-turn file buttons and summaries at the turn boundary.
- `src/components/file-preview/GeneratedFilesPanel.tsx`: adapt or replace presentation so created, modified, and deleted tool activities are represented accurately.
- `src/components/file-preview/ArtifactPanel.tsx`: render the session-level chronological change record and explicit empty state.
- `src/components/file-preview/FilePreviewBody.tsx`: reuse Monaco diff rendering for individual fragments without presenting the sequence as a full baseline diff.
- `src/lib/host-api.ts`, shared host contracts, and Main files service: add workspace-scoped read and stat operations needed by these tool-derived paths. This feature does not add workspace-scoped write, system-open, or reveal operations.

The implementation should make the smallest changes consistent with this ownership model. Legacy helpers may remain if they still have tests or other callers, but the ACP path must not depend on legacy Gateway message extraction.

## Internationalization And Styling

All new visible strings must be added to the `chat` namespace for `en`, `zh`, `ja`, and `ru`.

Required concepts include:

- Session has no file changes yet
- Change record
- Created, modified, deleted
- Diff unavailable for this tool activity
- File unavailable or outside workspace

The UI must reuse the design tokens and component conventions in `src/styles/globals.css`. Existing file-preview visual language should be preserved rather than introducing a separate card system.

## Testing

### Unit tests

- Parse OpenClaw titles and accept only exact `write`, `edit`, and `apply_patch` names.
- Reject pending, running, and failed calls; accept completed calls.
- Parse the four official path aliases in official precedence order.
- Parse Write content as an empty-to-new created fragment.
- Parse Edit `edits[]` and official top-level `oldText/newText` compatibility input.
- Reject broad legacy aliases such as `old_string/new_string` in this projection.
- Parse the canonical apply-patch envelope, accepted heredoc wrappers, Add, Update, Delete, immediate Move, optional first context marker, hunk prefixes, and End of File marker; reject the entire payload atomically on failure.
- Treat a Move whose normalized source and destination are equal as one modification.
- Enforce workspace-relative path normalization on POSIX and Windows forms.
- Reject traversal, outside absolute paths, and symlink escape through Main validation tests.
- Deduplicate repeated updates by tool-call identity.
- Aggregate same-path activity within a turn and preserve fragments across turns.
- Produce stable output for live and historical reducer items.
- Produce an empty session projection for New Session.

### Component tests

- Render per-turn file buttons and one summary row per path.
- Render created, modified, and deleted states with optional line counts.
- Route created/modified buttons to Preview and deleted buttons to Changes.
- Focus the selected turn/path in the session-level change record.
- Render same-turn fragments in one diff editor, composing safe chains and concatenating independent snippets without labeling them a full cumulative diff.
- Render the explicit session-level empty state when no qualifying activity exists.

### Electron E2E

- A live completed Write tool call creates a file button, `+N -0` summary, Preview navigation, and a session change record.
- Live completed Edit and apply-patch fragments for one file share one diff editor per turn.
- A failed supported tool does not appear.
- An unsupported tool does not appear.
- A deleted file button opens Changes rather than Preview.
- Switching to a New Session shows `This session has no file changes yet.` in Changes.
- Loading a session with full ACP tool replay restores its file activity.
- Loading history without raw tool replay does not invent activity.

## Harness And Validation

Implementation must add `harness/specs/tasks/restore-acp-file-activity.md` referencing `gateway-backend-communication`, because the work touches ACP-derived communication and typed Renderer/Main host file access.

Before implementation review, run:

```text
pnpm harness validate --spec harness/specs/tasks/restore-acp-file-activity.md
pnpm harness run --spec harness/specs/tasks/restore-acp-file-activity.md
pnpm run comms:replay
pnpm run comms:compare
pnpm run typecheck
pnpm test
pnpm run test:e2e -- tests/e2e/chat-file-changes.spec.ts
```

Exact targeted test commands may be selected in the implementation plan, but communication and Electron UI validation must not be omitted.

## Documentation

Review and update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` if they describe Chat artifacts, ACP compatibility, or the right-side panel.

Documentation must state:

- File activity comes from successful OpenClaw `write`, `edit`, and `apply_patch` calls.
- The recognized tool range matches the official OpenClaw Chat UI.
- ClawX excludes failed calls.
- The result is not a Git or verified filesystem diff and does not include shell/script side effects.

## Acceptance Criteria

- A successful OpenClaw Write, Edit, or apply-patch tool call in ACP Chat creates one per-turn file button per eligible path.
- The same turn shows one change-summary row per eligible path with tool-intent action and available line statistics.
- Write is rendered as empty-to-new and classified as created, even when it may overwrite an existing file.
- Edit and apply-patch render only fragments available from their canonical OpenClaw raw input.
- The right-side Changes tab renders at most one diff editor per turn and path, while preserving chronological records across turns.
- Failed and unsupported tool calls do not create file activity UI.
- All tool-provided paths are constrained to the session workspace before scoped preview reads or stats; tool-derived targets expose no system open or reveal operation.
- The right-side Changes tab is session-scoped, groups activity by path, and preserves chronological order within each path.
- A New Session with no successful supported file tool calls displays `This session has no file changes yet.` in the Changes tab.
- Selecting a created or modified file button opens current-file Preview; selecting a deleted file button opens its change record.
- Full ACP replay restores activity without a ClawX-owned persisted ledger; incomplete replay does not trigger fallback inference.
- The implementation does not scan the workspace, use Git, create snapshots, parse shell side effects, or modify OpenClaw.
- New UI text has complete `en`, `zh`, `ja`, and `ru` locale coverage.
- Unit, component, Electron E2E, harness, and communication regression validation cover the behavior.

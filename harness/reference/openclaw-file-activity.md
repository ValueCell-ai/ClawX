# OpenClaw File Activity

Status: current compatibility and safety reference, reviewed 2026-07-13.

Related scenario: `acp-file-activity`

Related rules: `tool-derived-file-safety`, `session-workspace-authority`

Related task: `restore-acp-file-activity`

## Semantics And Ownership

File activity is a pure Renderer projection over the active ACP timeline. It records file changes declared by successful OpenClaw file-editing tool calls. It is not a Git diff, a verified disk diff, or a session-start baseline.

ClawX does not scan or watch the workspace, create snapshots, infer shell/script side effects, parse arbitrary prose, call `sessions.files.list` to manufacture diffs, or persist an activity ledger. Main does not interpret tool semantics; it only performs workspace-scoped read/stat operations.

The supported tools are exactly `write`, `edit`, and `apply_patch`. Tool identity is the trimmed lowercase segment before the first colon in OpenClaw's ACP title. Status must be `completed`. Unsupported, malformed, pending, running, failed, and cancelled calls remain ordinary tool cards but produce no file activity.

## Canonical Inputs

For `write` and `edit`, path fields use this precedence: `path`, `file_path`, `filePath`, `file`.

`write` accepts string `content`, displays an empty-to-new fragment, and uses action `created`. This describes tool intent and does not assert that the file did not previously exist. A valid path without string content may produce a path-only record with unavailable line counts.

`edit` accepts `edits: Array<{ oldText, newText }>` and the official top-level `oldText`/`newText` compatibility shape. Invalid entries are skipped. Broad aliases such as `old_string` and `new_string` are intentionally unsupported.

`apply_patch` accepts OpenClaw's patch envelope and optional `<<EOF`, `<<'EOF'`, or `<<"EOF"` wrapper. Supported sections are Add, Update, Delete, and an immediate Move-to after Update. Add lines use `+`; Update lines use space, `-`, and `+`; the first Update chunk may omit `@@`; later chunks require it; `*** End of File` is syntax, not content. Grammar failure rejects the complete tool payload without partial activity. After a valid parse, independently unsafe paths may be omitted while valid in-workspace records remain.

A move normally creates source deletion and destination creation with update fragments attached to the destination. Equal normalized paths collapse to one modification.

## Data Model And Aggregation

The conceptual records are:

```ts
type AcpFileChangeFragment = {
  oldText: string;
  newText: string;
  sequence: number;
};

type AcpFileActivity = {
  turnId: string;
  toolCallId: string;
  toolName: 'write' | 'edit' | 'apply_patch';
  relativePath: string;
  action: 'created' | 'modified' | 'deleted';
  fragments: AcpFileChangeFragment[];
  sequence: number;
};
```

The implementation types in `src/lib/acp/openclaw-file-activities.ts` are authoritative. Sequence is derived display order, not persisted identity. Turn association reuses the ACP display grouping algorithm, including tool-only turns.

Reducer tool identity prevents duplicate activity. Within a turn, each path gets one button and summary while retaining chronological activities and fragments. Across the session, Changes groups by relative path in first-activity order and keeps turn records chronological. Exact duplicate pairs are omitted; safe chains compose when prior new text equals later old text; independent fragments share one display diff without claiming to be a cumulative patch.

Line counts normalize CRLF, compare fragments, and sum additions/removals. Missing countable fragments produce unavailable counts rather than invented zeroes.

## Path Security

Tool paths are untrusted. `workspaceRoot` is the containment boundary and `executionCwd` is the ACP working directory. Relative paths resolve against execution cwd; both relative and absolute candidates must remain lexically inside workspace root and use the same path family. Replay without authoritative root and cwd produces no projection.

Preview uses a relative reference end to end:

```ts
type WorkspaceFileRef = {
  workspaceRoot: string;
  relativePath: string;
};
```

Main independently canonicalizes each read/stat request, checks real paths and nearest existing parents, rejects traversal and symlink escape, and avoids following unsafe final links. Renderer lexical rejection prevents activity UI for obvious outside paths. A later Main rejection keeps the historical activity but shows localized unavailable feedback.

Tool-derived targets are read-only in-app previews. They never expose system open or reveal because path validation cannot be atomic with OS shell dispatch. Existing trusted workspace-browser targets may retain their established operations.

## User Experience And Replay

Each assistant turn shows one file button and one summary per eligible path. Created/modified buttons open current-file Preview; deleted buttons open Changes. Changes is session-scoped, grouped by file, and shows at most one diff editor per turn and path. Empty sessions explicitly state that the session has no file changes.

Full ACP structured replay restores available activity through the same projection. Transcript-only or incomplete replay does not infer missing records. Session switch clears the projection with the active timeline.

## Validation Anchors

Key tests include `tests/unit/openclaw-file-activities.test.ts`, `tests/unit/files-api-workspace.test.ts`, the file-preview component suites, and `tests/e2e/chat-file-changes.spec.ts`.

This reference replaces the former OpenClaw file activity hydration design while retaining its protocol grammar, security model, and aggregation semantics.

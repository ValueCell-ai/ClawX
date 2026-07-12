# OpenClaw File Activity Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore per-turn file buttons and tool-declared diffs in ACP Chat, plus a session-level Changes record and explicit New Session empty state.

**Architecture:** Add a pure Renderer projection over the existing ACP timeline that recognizes completed OpenClaw `write`, `edit`, and `apply_patch` calls and parses only their canonical `rawInput`. Keep current-file preview behind new workspace-scoped Main file APIs, then render per-turn summaries from timeline groups and session-level chronological fragments in the existing artifact panel.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Vitest, Playwright, Monaco, `diff`, react-i18next, ClawX harness.

## Global Constraints

- Follow the approved design in `docs/specs/2026-07-12-openclaw-file-activity-design.md`.
- Do not modify OpenClaw source or import private OpenClaw source modules at runtime.
- Do not scan or watch the workspace, invoke Git, create source snapshots, or infer shell/script side effects.
- Recognize only exact lowercase tool names `write`, `edit`, and `apply_patch`, parsed from the first colon-delimited segment of OpenClaw ACP tool titles.
- Project only `ToolCallItem.status === 'completed'`; failed, pending, and running calls produce no file activity.
- Parse canonical OpenClaw `rawInput` only. Do not parse `rawOutput`, tool text, ACP locations, assistant prose, generic ACP structured diffs, or broad legacy aliases such as `old_string/new_string`.
- Treat every valid Write as `created` with an empty-to-new diff, even when it may overwrite an existing file.
- Render apply-patch parsing atomically and match the installed OpenClaw grammar, including accepted heredoc wrappers, optional first `@@`, immediate Move, and End of File handling.
- Resolve relative tool paths against the ACP execution cwd and lexically constrain them to the authoritative session workspace root.
- Tool-derived preview and stat operations must use workspace-scoped Main APIs and must never fall back to existing unscoped APIs. Tool-derived targets expose no system open or reveal action because Electron's path-only OS shell calls cannot be atomically bound to the file Main validated.
- Do not add a scoped write API. Tool-derived Preview is read-only.
- Preserve all same-path activity fragments in chronological order. Do not present them as a net source-baseline diff.
- The Changes tab is session-scoped. With no qualifying activity, including New Session, show `This session has no file changes yet.` through i18n.
- Route all new visible text through `en`, `zh`, `ja`, and `ru` `chat.json` files and follow `src/styles/globals.css` component conventions.
- Add or update Electron E2E coverage for every user-visible behavior.
- Keep Renderer/Main communication behind `src/lib/host-api.ts`; do not add direct IPC or Gateway calls.
- Add the required harness task before backend communication changes and run comms regression validation before completion.
- Review and update all three README files for the final behavior.

---

### Task 1: Add The Harness Task Specification

**Files:**
- Create: `harness/specs/tasks/restore-acp-file-activity.md`
- Reference: `harness/specs/scenarios/gateway-backend-communication.md`
- Reference: `harness/specs/tasks/acp-image-generation-compatibility.md`
- Reference: `harness/specs/tasks/chat-workspace-context.md`

**Interfaces:**
- Consumes: Harness task-spec frontmatter and the existing `gateway-backend-communication` scenario.
- Produces: A validated `restore-acp-file-activity` task spec used by every later validation step.

- [ ] **Step 1: Write the task spec**

  Use this complete frontmatter, adding no broad repository globs:

  ```yaml
  ---
  id: restore-acp-file-activity
  title: Restore OpenClaw file activity in ACP Chat
  scenario: gateway-backend-communication
  taskType: runtime-bridge
  intent: Restore per-turn and session-level OpenClaw file activity in ACP Chat while keeping tool-derived file access inside the bound workspace.
  touchedAreas:
    - docs/plans/2026-07-12-openclaw-file-activity.md
    - docs/specs/2026-07-12-openclaw-file-activity-design.md
    - harness/specs/tasks/restore-acp-file-activity.md
    - shared/host-api/contract.ts
    - electron/services/files-api.ts
    - src/lib/host-api.ts
    - src/lib/file-preview-client.ts
    - src/lib/acp/openclaw-file-activities.ts
    - src/lib/acp/timeline-groups.ts
    - src/components/file-preview/types.ts
    - src/components/file-preview/build-preview-target.ts
    - src/components/file-preview/FilePreviewBody.tsx
    - src/components/file-preview/open-file-utils.ts
    - src/components/file-preview/ImageViewer.tsx
    - src/components/file-preview/PdfViewer.tsx
    - src/components/file-preview/SheetViewer.tsx
    - src/components/file-preview/HtmlPreview.tsx
    - src/components/file-preview/AcpSessionChangesView.tsx
    - src/components/file-preview/ArtifactPanel.tsx
    - src/pages/Chat/index.tsx
    - src/pages/Chat/AcpTimeline.tsx
    - src/pages/Chat/AcpAssistantTurn.tsx
    - src/pages/Chat/AcpTurnFileActivity.tsx
    - src/stores/artifact-panel.ts
    - shared/i18n/locales/en/chat.json
    - shared/i18n/locales/zh/chat.json
    - shared/i18n/locales/ja/chat.json
    - shared/i18n/locales/ru/chat.json
    - tests/unit/openclaw-file-activities.test.ts
    - tests/unit/acp-timeline-groups.test.ts
    - tests/unit/files-api-workspace.test.ts
    - tests/unit/file-preview-client.test.ts
    - tests/unit/host-api-facade.test.ts
    - tests/unit/host-invoke.test.ts
    - tests/unit/file-preview-body.test.tsx
    - tests/unit/open-file-utils.test.ts
    - tests/unit/image-viewer.test.tsx
    - tests/unit/rich-file-viewers.test.tsx
    - tests/unit/html-preview.test.tsx
    - tests/unit/acp-chat-components.test.tsx
    - tests/unit/chat-acp-page.test.tsx
    - tests/unit/artifact-panel-store.test.ts
    - tests/unit/artifact-panel.test.tsx
    - tests/unit/chat-artifact-panel-layout.test.tsx
    - tests/e2e/chat-file-changes.spec.ts
    - tests/e2e/fixtures/electron.ts
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  expectedUserBehavior:
    - Successful OpenClaw write, edit, and apply_patch calls render per-turn file buttons and change summaries.
    - The Changes tab shows a session-level record grouped by file and preserves each file's chronological fragments.
    - A New Session with no qualifying activity says that this session has no file changes yet.
    - Tool-derived targets provide read-only in-app Preview with no system open or reveal action.
  requiredProfiles:
    - fast
    - comms
    - e2e
  requiredRules:
    - renderer-main-boundary
    - backend-communication-boundary
    - api-client-transport-policy
    - host-api-fallback-policy
    - host-events-fallback-policy
    - comms-regression
    - docs-sync
  requiredTests:
    - pnpm run typecheck
    - pnpm test
    - pnpm run test:e2e -- tests/e2e/chat-file-changes.spec.ts
    - pnpm run comms:replay
    - pnpm run comms:compare
  acceptance:
    - Only completed OpenClaw write, edit, and apply_patch canonical raw inputs produce file activity.
    - Failed and unsupported tools remain visible as ordinary tool cards but produce no file activity UI.
    - Tool-derived Preview uses workspace-scoped read/stat host APIs without unscoped fallback and exposes no system open or reveal action.
    - The feature does not scan the workspace, use Git, create source snapshots, or infer shell side effects.
    - Full ACP replay restores available file activity and incomplete replay does not invent it.
  docs:
    required: true
  ---
  ```

- [ ] **Step 2: Validate the task spec and observe any structural failure**

  Run:

  ```bash
  pnpm harness validate --spec harness/specs/tasks/restore-acp-file-activity.md --since abbb311
  ```

  Expected: validation succeeds. If a named profile or rule is unavailable, inspect the scenario/rule registry and correct the spec rather than bypassing validation.

- [ ] **Step 3: Validate the selected execution flow**

  Run:

  ```bash
  pnpm harness run --spec harness/specs/tasks/restore-acp-file-activity.md --since abbb311 --dry-run
  ```

  Expected: dry-run passes the backend-boundary scan and prints the commands selected by the declared profiles without executing them. The fixed base `abbb311` is the approved design-spec commit and excludes unrelated earlier branch history.

- [ ] **Step 4: Commit the task**

  ```bash
  git add docs/plans/2026-07-12-openclaw-file-activity.md harness/specs/tasks/restore-acp-file-activity.md
  git commit -m "docs: add ACP file activity implementation plan"
  ```

---

### Task 2: Build The Pure OpenClaw File Activity Projection

**Files:**
- Create: `src/lib/acp/openclaw-file-activities.ts`
- Create: `tests/unit/openclaw-file-activities.test.ts`
- Modify if grouping needs an exported stable helper: `src/lib/acp/timeline-groups.ts`
- Test if grouping changes: `tests/unit/acp-timeline-groups.test.ts`
- Regression test: `tests/unit/acp-reducer.test.ts`

**Interfaces:**
- Consumes: `AcpTimelineSnapshot`, `ToolCallItem`, and `groupAcpTimelineItems()`.
- Produces: `OpenClawFileToolName`, `AcpFileChangeFragment`, `AcpFileActivity`, `AcpTurnFileSummary`, `AcpSessionFileGroup`, `AcpFileActivityProjection`, and `projectOpenClawFileActivities()`.

- [ ] **Step 1: Write failing projection tests**

  Define the expected public API in the test:

  ```ts
  export function projectOpenClawFileActivities(input: {
    timeline: AcpTimelineSnapshot;
    workspaceRoot: string;
    executionCwd: string;
  }): AcpFileActivityProjection;
  ```

  Cover these cases before implementation:

  - Lowercase, uppercase, mixed-case, and whitespace-padded `write: ...`, `edit: ...`, and `apply_patch: ...` prefixes normalize and are accepted; `WriteFile`, `rewrite`, `read`, `exec`, and malformed near-matches are rejected.
  - Only completed calls project activity.
  - Path alias precedence is `path`, `file_path`, `filePath`, `file`.
  - Write `content` becomes one created empty-to-new fragment and `+N -0`.
  - Missing Write content produces a path-only created summary with null counts.
  - Edit supports `edits[].oldText/newText` and top-level `oldText/newText` only.
  - `old_string/new_string` is rejected rather than treated as a diff.
  - apply-patch supports Add, Update, Delete, Move, CRLF, `<<EOF`/quoted wrappers, omitted first `@@`, later `@@`, empty context lines, and `*** End of File`.
  - Any malformed apply-patch payload discards that entire tool activity.
  - Same-normalized-path Move produces one modified activity; a real move produces deleted source and created destination.
  - POSIX and Windows relative paths resolve against `executionCwd`; traversal and outside absolute paths are excluded.
  - The selector requires canonical absolute `workspaceRoot` and `executionCwd` values; non-absolute context is rejected before any activity is projected.
  - Tool-only assistant groups receive their own `turnId`.
  - Duplicate updates with one `toolCallId` do not duplicate activity.
  - Same-turn same-path summaries fold action and sum counts: created then modified remains created; any final deletion becomes deleted; deleted then created becomes created.
  - CRLF normalization, empty text, trailing newline, and context-only hunk line counts match `diffLines` semantics.
  - `historical: true` items project identically to live items.
  - Empty timeline returns zero files and empty maps/groups.

- [ ] **Step 2: Run the focused tests and verify failure**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/openclaw-file-activities.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-reducer.test.ts
  ```

  Expected: the new suite fails because the module and exports do not exist; existing timeline/reducer suites remain green.

- [ ] **Step 3: Implement the projection types and title/path parsing**

  In `src/lib/acp/openclaw-file-activities.ts`:

  - Parse the title prefix before the first colon, trim/lowercase it, and accept only the exact three names.
  - Use `groupAcpTimelineItems(timeline)` and `assistant-turn` group IDs as turn IDs.
  - Iterate group items in existing order and only inspect completed `tool-call` items.
  - Resolve relative paths from `executionCwd`, convert accepted paths to workspace-relative slash-separated paths, and reject lexical escapes from `workspaceRoot`.
  - Require absolute canonical roots from the scoped workspace-context resolver added in Task 3. The selector never expands `~` or guesses a home directory.
  - Keep title parsing, path lookup, tool parsing, aggregation, and line-stat helpers private unless a test requires a stable public helper.

- [ ] **Step 4: Implement canonical Write and Edit parsing**

  - Write reads only string `content` and always emits `created`.
  - Edit reads canonical `edits[]` first and top-level `oldText/newText` as the official compatibility shape.
  - Invalid edit entries are skipped; a valid path still emits path-only activity when no valid pair remains.
  - Do not read `item.output`, `item.outputParts`, or `item.locations`.

- [ ] **Step 5: Implement an atomic OpenClaw apply-patch parser**

  Mirror the grammar of the installed OpenClaw parser without importing its private bundle:

  - Trim and split LF/CRLF.
  - Remove the three accepted heredoc wrapper forms.
  - Validate Begin/End markers.
  - Parse Add, Delete, Update, immediate Move, chunks, context, additions/removals, and End of File.
  - Permit a missing context marker only for the first Update chunk.
  - Parse into a temporary activity array and return nothing if any part throws, so no partial records escape.

- [ ] **Step 6: Implement aggregation and line statistics**

  Produce:

  ```ts
  type AcpFileActivityProjection = {
    activities: AcpFileActivity[];
    turnSummariesByTurnId: Record<string, AcpTurnFileSummary[]>;
    fileGroups: AcpSessionFileGroup[];
    uniqueFileCount: number;
  };
  ```

  File groups are ordered by first activity; activities/fragments remain chronological within a path. Implement the explicit action transition rules tested in Step 1 rather than last-action-wins. Use `diffLines` after CRLF normalization and do not gate stats on file extension.

- [ ] **Step 7: Run focused and regression tests**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/openclaw-file-activities.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-reducer.test.ts
  pnpm run typecheck:web
  ```

  Expected: all tests and Renderer typecheck pass.

- [ ] **Step 8: Commit the task**

  ```bash
  git add src/lib/acp/openclaw-file-activities.ts tests/unit/openclaw-file-activities.test.ts src/lib/acp/timeline-groups.ts tests/unit/acp-timeline-groups.test.ts
  git commit -m "feat(chat): project OpenClaw file activities"
  ```

  Stage the two timeline-group files only if they changed.

---

### Task 3: Add Workspace-Scoped Host File Operations

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/lib/file-preview-client.ts`
- Modify: `electron/services/files-api.ts`
- Create: `tests/unit/files-api-workspace.test.ts`
- Test: `tests/unit/file-preview-client.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`
- Regression-only, do not modify unless its existing assertions require typed action coverage: `tests/unit/host-invoke.test.ts`

**Interfaces:**
- Consumes: Existing file result/error types and Main `CompleteHostServiceRegistry['files']` registration.
- Produces: Shared `WorkspaceFileRef`, a canonical workspace-context resolver, and three scoped host methods: text read, binary read, and stat.

- [ ] **Step 1: Write failing shared-facade and Main validation tests**

  Add the exact shared type:

  ```ts
  export type WorkspaceFileRef = {
    workspaceRoot: string;
    relativePath: string;
  };

  export type WorkspaceContextInput = {
    workspaceRoot: string;
    executionCwd: string;
  };
  ```

  Add tests proving:

  - `hostApi.files` and `file-preview-client` forward exact typed payloads for the resolver and all three scoped file methods.
  - `resolveWorkspaceContext({ workspaceRoot, executionCwd })` expands the default `~/.openclaw/workspace`, canonicalizes both directories, requires cwd containment, and returns validated absolute values.
  - The resolver rejects missing roots, non-directory roots, and cwd outside the root.
  - A normal child text/binary/stat request succeeds.
  - Absolute `relativePath`, `..`, root-prefix collisions, and empty roots/paths fail with `outsideSandbox`.
  - Existing symlink targets and symlinked parents escaping the root fail.
  - A missing leaf under a safe canonical parent returns `notFound`.
  - A missing leaf below an escaping symlink fails with `outsideSandbox`.
  - No workspace-scoped system open/reveal action exists; tool-derived targets cannot reach Electron shell APIs.
  - Existing text and binary size limits still apply.

- [ ] **Step 2: Run focused tests and verify failure**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/files-api-workspace.test.ts tests/unit/file-preview-client.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts
  ```

  Expected: new contract/method assertions fail because scoped operations do not exist.

- [ ] **Step 3: Add the shared contract and Renderer facade**

  Extend `HostApiContract.files` with:

  ```ts
  resolveWorkspaceContext(input: WorkspaceContextInput): Promise<{
    ok: boolean;
    workspaceRoot?: string;
    executionCwd?: string;
    error?: FilePreviewError;
  }>;
  readWorkspaceText(ref: WorkspaceFileRef): Promise<ReadTextFileResult>;
  readWorkspaceBinary(input: WorkspaceFileRef & { maxBytes?: number }): Promise<ReadBinaryFileResult>;
  statWorkspaceFile(ref: WorkspaceFileRef): Promise<StatFileResult>;
  ```

  Add matching `hostApi.files` methods and named wrappers in `src/lib/file-preview-client.ts`. The resolver may return canonical absolute root/cwd values because they are validated containment boundaries, not arbitrary file targets. Do not add legacy IPC channels or a scoped write method.

- [ ] **Step 4: Implement workspace-context and target validation in Main**

  First implement `resolveWorkspaceContext`: expand `~` with Main's home directory, realpath both directories, require both to exist as directories, and require canonical cwd containment inside canonical root. Return only those validated canonical directory paths.

  Then add one internal target validator used independently by all three operations:

  - Expand and realpath `workspaceRoot`; require an existing directory.
  - Require a non-empty relative path and reject absolute/parent-traversing input before joining.
  - For existing targets, realpath and enforce platform-correct containment.
  - For missing targets, walk to the nearest existing parent, realpath it, enforce containment, then return `notFound`.
  - Reject symlinks that leave the root.
  - Keep case-insensitive comparisons on Windows and strict comparisons on POSIX.

  Reuse existing read/stat size and binary checks after validation. Do not expose scoped shell open or reveal methods: Electron's path-only OS shell calls leave a symlink-swap window after validation.

- [ ] **Step 5: Run focused tests and both typechecks**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/files-api-workspace.test.ts tests/unit/file-preview-client.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts
  pnpm run typecheck
  ```

  Expected: scoped validation tests, existing host tests, and both TypeScript projects pass.

- [ ] **Step 6: Commit the task**

  ```bash
  git add shared/host-api/contract.ts src/lib/host-api.ts src/lib/file-preview-client.ts electron/services/files-api.ts tests/unit/files-api-workspace.test.ts tests/unit/file-preview-client.test.ts tests/unit/host-api-facade.test.ts
  git commit -m "feat(files): add workspace-scoped file access"
  ```

  If `tests/unit/host-invoke.test.ts` changed because the dispatcher needed new assertions, stage it in the same commit.

---

### Task 4: Route Tool-Derived Targets Through Scoped Preview APIs

**Files:**
- Modify: `src/components/file-preview/types.ts`
- Modify: `src/components/file-preview/build-preview-target.ts`
- Modify: `src/components/file-preview/FilePreviewBody.tsx`
- Modify: `src/components/file-preview/open-file-utils.ts`
- Modify: `src/components/file-preview/ImageViewer.tsx`
- Modify: `src/components/file-preview/PdfViewer.tsx`
- Modify: `src/components/file-preview/SheetViewer.tsx`
- Modify: `src/components/file-preview/HtmlPreview.tsx`
- Test: `tests/unit/file-preview-body.test.tsx`
- Test: `tests/unit/file-preview-client.test.ts`
- Test: `tests/unit/image-viewer.test.tsx`
- Create: `tests/unit/rich-file-viewers.test.tsx`
- Create: `tests/unit/html-preview.test.tsx`
- Create: `tests/unit/open-file-utils.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFileRef` and scoped wrappers from Task 3.
- Produces: `FilePreviewTarget.workspaceFileRef`, `buildWorkspacePreviewTarget()`, and scoped-aware read-only preview/viewer behavior.

- [ ] **Step 1: Write failing scoped preview tests**

  Test two explicit modes:

  - Trusted target without `workspaceFileRef` continues to use existing unscoped APIs.
  - Tool-derived target with `workspaceFileRef` calls only scoped text/stat/binary methods and renders no system open/reveal action.

  Include failures proving a scoped API error never retries through an unscoped path. Put image routing assertions in `image-viewer.test.tsx`, PDF/sheet routing assertions in `rich-file-viewers.test.tsx`, and direct `file://` base assertions in `html-preview.test.tsx`.

- [ ] **Step 2: Run focused tests and verify failure**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/file-preview-body.test.tsx tests/unit/file-preview-client.test.ts tests/unit/open-file-utils.test.ts tests/unit/image-viewer.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/html-preview.test.tsx
  ```

  Expected: tests fail because targets/viewers cannot carry or route a workspace reference.

- [ ] **Step 3: Extend the target and builder**

  Add:

  ```ts
  interface FilePreviewTarget {
    workspaceFileRef?: WorkspaceFileRef;
    // retain existing trusted/legacy fields
  }
  ```

  Add `buildWorkspacePreviewTarget(ref, metadata?)` that returns a target with `workspaceFileRef: ref` and sets the required legacy `filePath` field to the normalized `relativePath` for display/key purposes only. Derive file name, extension, MIME, and content type from that relative path. Never put a resolved absolute target into `filePath`. Keep `buildPreviewTarget()` unchanged for trusted callers.

- [ ] **Step 4: Route text and stat while suppressing system actions**

  In `FilePreviewBody`, branch on `workspaceFileRef` before reading `filePath`: select scoped wrappers whenever the reference exists and use `filePath` only for labels/keys in that branch. Tool-derived targets remain read-only and do not expose Save/Revert, system open, or reveal controls, including rich-document toolbar replacement and too-large/unsupported fallbacks.

  Keep `open-file-utils.ts` path-only for existing trusted targets without `workspaceFileRef`. Scoped targets must not call these helpers.

- [ ] **Step 5: Route rich viewers and HTML safely**

  Add optional `workspaceFileRef` props to Image/PDF/Sheet viewers and select scoped binary reads. Add a scoped flag/reference to `HtmlPreview` and skip `injectBaseHref()` for scoped tool targets so no direct `file://` base is created.

- [ ] **Step 6: Run focused tests and Renderer typecheck**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/file-preview-body.test.tsx tests/unit/file-preview-client.test.ts tests/unit/open-file-utils.test.ts tests/unit/image-viewer.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/html-preview.test.tsx
  pnpm run typecheck:web
  ```

  Expected: trusted preview regressions and all scoped routing assertions pass.

- [ ] **Step 7: Commit the task**

  ```bash
  git add src/components/file-preview/types.ts src/components/file-preview/build-preview-target.ts src/components/file-preview/FilePreviewBody.tsx src/components/file-preview/open-file-utils.ts src/components/file-preview/ImageViewer.tsx src/components/file-preview/PdfViewer.tsx src/components/file-preview/SheetViewer.tsx src/components/file-preview/HtmlPreview.tsx tests/unit/file-preview-body.test.tsx tests/unit/file-preview-client.test.ts tests/unit/open-file-utils.test.ts tests/unit/image-viewer.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/html-preview.test.tsx
  git commit -m "feat(preview): scope tool-derived file access"
  ```

---

### Task 5: Integrate Per-Turn And Session File Activity UI

**Files:**
- Create: `src/pages/Chat/AcpTurnFileActivity.tsx`
- Create: `src/components/file-preview/AcpSessionChangesView.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/AcpTimeline.tsx`
- Modify: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `src/components/file-preview/ArtifactPanel.tsx`
- Modify: `src/stores/artifact-panel.ts`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-chat-components.test.tsx`
- Test: `tests/unit/chat-acp-page.test.tsx`
- Create: `tests/unit/artifact-panel-store.test.ts`
- Test: `tests/unit/artifact-panel.test.tsx`
- Test: `tests/unit/chat-artifact-panel-layout.test.tsx`
- Regression test: `tests/unit/file-preview-body.test.tsx`

**Interfaces:**
- Consumes: `AcpFileActivityProjection`, `AcpTurnFileSummary`, `AcpSessionFileGroup`, `buildWorkspacePreviewTarget()`, effective workspace root, and ACP store cwd.
- Produces: Per-turn file controls, session-level Changes records, exact empty state, and `ArtifactChangeFocus` navigation.

- [ ] **Step 1: Write failing Chat, store, and panel tests**

  Assert all of the following before implementation:

  - `AcpTimeline` passes summaries keyed by assistant group ID.
  - Tool-only assistant groups render file controls once after their timeline items.
  - One unique path creates one file button and one summary row per turn.
  - Created/modified buttons open scoped Preview.
  - Deleted buttons and every summary row open Changes with `{ relativePath, turnId }`.
  - `+/-` and created/modified/deleted labels render from projection data; path-only activity omits counts.
  - Unsupported, failed, location-only, and resource-link-only items create no tool activity controls or session records.
  - Existing assistant resource parts remain ordinary message content.
  - A default `~/.openclaw/workspace` context is resolved through Main before projection, and an absolute tool path inside the returned canonical root is accepted.
  - The store keeps `focusedFile` and `focusedChange` separate and clears both on close/session switch.
  - Changes is always present, including when Preview focuses PDF/XLS/XLSX.
  - Empty activity renders the exact localized `This session has no file changes yet.` state and ignores unrelated Preview focus.
  - A non-empty Changes view renders `uniqueFileCount` as the session-level changed-file count.
  - File groups are ordered by first activity and turn records are ordered within each path.
  - Same-turn fragments for one path render through one Monaco editor: compose safe sequential chains, replay unique replacements over known created content, and concatenate independent snippets. Path-only/deletion-without-content records show diff-unavailable copy.
  - Change focus expands the matching path and scrolls to the selected turn's first activity.

- [ ] **Step 2: Run focused tests and verify failure**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/chat-artifact-panel-layout.test.tsx tests/unit/file-preview-body.test.tsx
  ```

  Expected: tests fail because Chat still derives legacy path-only files, assistant turns lack controls, and Changes keeps only one latest `GeneratedFile`.

- [ ] **Step 3: Extend artifact focus state**

  Add:

  ```ts
  export type ArtifactChangeFocus = {
    relativePath: string;
    turnId?: string;
    activitySequence?: number;
  };
  ```

  Store `focusedChange` separately. Change `openChanges()` to accept `ArtifactChangeFocus | null`; keep `openPreview()` focused on `FilePreviewTarget`. Persist neither focus.

- [ ] **Step 4: Replace Chat's current ACP generated-file derivation**

  Remove `deriveAcpGeneratedFiles()` from `src/pages/Chat/index.tsx`. When the current session's effective workspace or ACP store cwd changes, call `hostApi.files.resolveWorkspaceContext({ workspaceRoot, executionCwd })`. Keep the resolved context in session-keyed Renderer state, discard stale async responses after a session/context change, and clear it on session switch.

  Derive one projection with `useMemo` only when timeline and active ACP session both match `currentSessionKey` and the resolver has returned canonical absolute root/cwd values for that exact context. While resolution is pending or rejected, use an empty projection; New Session still shows the session empty state. Pass the projection to both `AcpTimeline` and `ArtifactPanel`. Do not include resource parts, output parts, or locations.

- [ ] **Step 5: Implement `AcpSessionChangesView` and replace panel props**

  Replace `ArtifactPanel.files` with `fileGroups` and `uniqueFileCount`. Remove latest-file dedup logic. Render the unique session file count in the Changes header, then one group per path with stable path/turn/activity IDs and at most one `MonacoDiffViewer` per turn and path. Keep Changes available for rich Preview files. Implement exact empty state, unavailable records, safe same-turn fragment composition, and focus/scroll behavior.

- [ ] **Step 6: Implement per-turn file controls**

  In `AcpTurnFileActivity.tsx`, render one file button and one change-summary row per path using existing design tokens. Add it after `group.items` and before the hover bar. Build scoped targets from `{ workspaceRoot, relativePath }`; created/modified buttons call `openPreview(target)`, while deleted buttons and summary rows call `openChanges({ relativePath, turnId })`.

- [ ] **Step 7: Add complete locale coverage**

  Add created, modified, deleted, file changes title/count, file button, change record, exact session empty state, diff unavailable, and file unavailable/outside workspace keys to all four locale files. Do not rely on English default strings.

- [ ] **Step 8: Run focused tests and Renderer typecheck**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/chat-artifact-panel-layout.test.tsx tests/unit/file-preview-body.test.tsx
  pnpm run typecheck:web
  ```

  Expected: per-turn controls, session records, focus routing, empty state, existing panel layout, and ACP Chat page tests pass in one compilable change.

- [ ] **Step 9: Commit the task**

  ```bash
  git add src/pages/Chat/AcpTurnFileActivity.tsx src/components/file-preview/AcpSessionChangesView.tsx src/pages/Chat/index.tsx src/pages/Chat/AcpTimeline.tsx src/pages/Chat/AcpAssistantTurn.tsx src/components/file-preview/ArtifactPanel.tsx src/stores/artifact-panel.ts shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/artifact-panel.test.tsx tests/unit/chat-artifact-panel-layout.test.tsx tests/unit/file-preview-body.test.tsx
  git commit -m "feat(chat): restore ACP file activity UI"
  ```

---

### Task 6: Cover The Complete Electron Interaction

**Files:**
- Modify: `tests/e2e/chat-file-changes.spec.ts`
- Modify: `tests/e2e/fixtures/electron.ts`

**Interfaces:**
- Consumes: Live/replayed ACP update fixtures, scoped host actions, per-turn UI, and the session Changes panel.
- Produces: Electron-level regression coverage for the approved user flow.

- [ ] **Step 1: Rewrite the obsolete E2E fixtures and add failing scenarios**

  Replace location-only edit fixtures with canonical ACP sequences:

  ```text
  tool_call(title, rawInput, in_progress)
  tool_call_update(completed)
  ```

  Add a dedicated live helper that intercepts `sendAcpPrompt`, returns the active generation, and then emits `chat:acp-session-update` envelopes with `historical: false`. Keep the existing load helper only for separate replay scenarios.

  Add scenarios for:

  - Live completed Write renders one file button, created `+N -0`, scoped Preview, and a session record.
  - Live completed Edit and apply-patch render declared fragments.
  - Failed supported and completed unsupported tools still render their ordinary ACP tool cards but create no file buttons, summary rows, counts, or session change records.
  - Deleted file button opens Changes instead of Preview.
  - Two turns editing one path preserve both fragment sections.
  - Session switch/replay restores full-ledger activity.
  - Missing raw-input replay does not invent activity.
  - New Session Changes shows `This session has no file changes yet.`.
  - A scoped host rejection shows unavailable feedback and does not trigger an unscoped shell/file action.

- [ ] **Step 2: Run the focused E2E and verify failure**

  Run:

  ```bash
  pnpm run test:e2e -- tests/e2e/chat-file-changes.spec.ts
  ```

  Expected: new assertions fail until fixtures and all UI wiring match the approved flow.

- [ ] **Step 3: Add explicit live and replay fixture routing**

  Add typed `host:invoke` mock handling for scoped file actions and a reusable live ACP event sender that preserves the current session key/generation and sets `historical: false`. Keep replay updates emitted from `loadAcpSession` with `historical: true`. Do not add direct legacy `file:*` IPC channels or Renderer protocol fallbacks.

- [ ] **Step 4: Run the focused E2E again**

  Run:

  ```bash
  pnpm run test:e2e -- tests/e2e/chat-file-changes.spec.ts
  ```

  Expected: Vite builds and every file-activity Electron scenario passes.

- [ ] **Step 5: Commit the task**

  ```bash
  git add tests/e2e/chat-file-changes.spec.ts tests/e2e/fixtures/electron.ts
  git commit -m "test(chat): cover ACP file activity flow"
  ```

---

### Task 7: Document Semantics And Run Final Validation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Verify: `harness/specs/tasks/restore-acp-file-activity.md`

**Interfaces:**
- Consumes: Final implemented behavior and the approved design terminology.
- Produces: User-facing architecture documentation and complete validation evidence.

- [ ] **Step 1: Update all README variants**

  In each language, document:

  - File activity comes from successful OpenClaw `write`, `edit`, and `apply_patch` calls.
  - Tool recognition aligns with official OpenClaw Chat UI; completed-only filtering is ClawX-specific.
  - Write is shown as tool-declared creation/all-added.
  - Changes is a session-level chronological activity record, not Git or a verified source-baseline diff.
  - Shell/script/user/IDE side effects are not detected.
  - Full ACP replay can restore activity; incomplete replay does not trigger fallback inference.

- [ ] **Step 2: Run harness structural and selected-flow validation**

  Run:

  ```bash
  pnpm harness validate --spec harness/specs/tasks/restore-acp-file-activity.md --since abbb311
  pnpm harness run --spec harness/specs/tasks/restore-acp-file-activity.md --since abbb311
  ```

  Expected: the real task spec validates and all selected checks complete; do not use `--no-diff`.

- [ ] **Step 3: Run communication regressions**

  Run:

  ```bash
  pnpm run comms:replay
  pnpm run comms:compare
  ```

  Expected: replay metrics complete and comparison reports no unapproved regression.

- [ ] **Step 4: Run type, unit, build, and focused Electron validation**

  Run:

  ```bash
  pnpm run typecheck
  pnpm test
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts
  ```

  Expected: both TypeScript projects, full Vitest suite, Vite production build, and focused Electron E2E pass.

- [ ] **Step 5: Inspect the final diff and confirm scope**

  Run:

  ```bash
  git status --short
  git diff --check
  git diff --stat
  ```

  Confirm there is no workspace scanner, Git dependency, source snapshot, raw-output parser, generic ACP fallback, scoped write API, direct IPC, direct Gateway request, or OpenClaw source change.

- [ ] **Step 6: Commit documentation and any validation-only fixture metadata**

  ```bash
  git add README.md README.zh-CN.md README.ja-JP.md
  git commit -m "docs(chat): explain ACP file activity semantics"
  ```

  Do not commit generated logs or temporary validation output.

---

## Completion Checklist

- [ ] Harness task exists and passes real validation.
- [ ] Pure projection is deterministic for live and replay timelines.
- [ ] Only completed `write`, `edit`, and `apply_patch` canonical inputs produce activity.
- [ ] Apply-patch parsing matches the installed OpenClaw grammar and is atomic.
- [ ] Workspace-scoped read/stat operations reject traversal and symlink escape.
- [ ] Tool-derived preview exposes no system open/reveal action and never falls back to an unscoped file/shell operation.
- [ ] Per-turn file buttons and summaries render once per unique path.
- [ ] Session Changes preserves chronological per-file turn records and renders at most one diff editor per turn and path.
- [ ] New Session displays the exact localized empty state.
- [ ] Deleted buttons route to Changes; created/modified buttons route to scoped Preview.
- [ ] Full ACP replay restores activity; incomplete replay does not invent it.
- [ ] All four locales and all three README files are synchronized.
- [ ] Unit, E2E, harness, comms, typecheck, and build validation pass.

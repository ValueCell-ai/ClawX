# Office Document Preview Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only DOCX and PPTX previews to ClawX's existing workspace, Preview-panel, generated-file, and authorized-attachment flows.

**Architecture:** Extend the existing rich-file capability model with `docx` and `pptx`, then lazy-load dedicated Renderer-only viewers that consume the current Host API binary-read routes. DOCX renders isolated HTML inside a Shadow Root; PPTX renders one slide at a time to Canvas and is conditionally mounted so only one `pptxviewjs@1.1.9` instance exists in the shared Electron Renderer.

**Tech Stack:** React 19, TypeScript, Electron, Vite, Vitest, Playwright, `docx-preview`, exactly `pptxviewjs@1.1.9`, JSZip, Chart.js, react-i18next.

## Global Constraints

- Support inline preview only for `.docx` and `.pptx`; `.doc` and `.ppt` remain system-open-only.
- Extension is authoritative. MIME alone must not route an unknown or legacy extension into an OOXML parser.
- DOCX/PPTX compressed input is capped at exactly `20 * 1024 * 1024` bytes. Text stays at 2 MB; image/PDF/sheet stays at 50 MB.
- Authorized attachment and workspace references must never retry through `filePath`. Reject a target containing both scoped reference types before any read.
- The Workspace Browser keeps its existing Host-validated absolute-path read flow; do not manufacture a `WorkspaceFileRef` there.
- Render only in the Renderer from `Uint8Array`; do not add IPC, Host API, Main-process conversion, temporary files, cloud conversion, or URL loading.
- `docx-preview` must render into detached containers inside a Shadow Root with `renderAltChunks`, comments, and tracked changes disabled. Every DOCX anchor default action is disabled.
- Pin `pptxviewjs` to `1.1.9`. Construct it with `enableThumbnails: false`, `slideSizeMode: 'fit'`, and `autoChartRerenderDelayMs: 0`.
- At most one `PptxViewer` may be mounted in the Electron Renderer because `pptxviewjs@1.1.9` shares `window.currentProcessor` and `window.currentZipData`. Keep a code comment at each conditional mount site explaining this correctness constraint and referencing the approved design.
- PPTX initial, restored, navigation, chart-complete, and resize renders use one serialized scheduler. Resize uses a 100 ms trailing debounce.
- Before PPTX initial render, wait a bounded number of animation frames for positive container dimensions and synchronize Canvas CSS width/height before calling `render()`.
- Call public `destroy()` on unmount, but do not patch the accepted dependency-level retained-resource behavior.
- Route every new string through the `chat` namespace with matching English, Chinese, Japanese, and Russian entries. Use the design tokens documented in `src/styles/globals.css`.
- Preserve existing PDF, sheet, image, HTML, Markdown, source, diff, remote-attachment, and system-open behavior.
- Update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` in the same implementation.
- Do not run comms replay/compare: this change does not alter Gateway, delivery, runtime, or fallback transport.

---

### Task 1: Add Harness Contract

**Files:**
- Create: `harness/specs/tasks/office-document-preview.md`
- Create: `harness/specs/rules/office-preview-safety.md`
- Modify: `harness/specs/scenarios/chat-workspace-and-navigation.md`
- Modify: `harness/reference/chat-workspace-and-navigation.md`
- Modify: `tests/unit/harness-specs.test.ts`

**Interfaces:**
- Consumes: Approved requirements in `docs/specs/2026-07-22-office-document-preview-design.md`.
- Produces: Task ID `office-document-preview`, rule ID `office-preview-safety`, expanded `chat-workspace-and-navigation` ownership, and executable harness validation requirements used by every later task.

- [ ] **Step 1: Write the failing harness contract test**

  Add a test to `tests/unit/harness-specs.test.ts` that loads the new task, all rules, and all scenarios, then expects:

  ```ts
  expect(task.data).toMatchObject({
    id: 'office-document-preview',
    scenario: 'chat-workspace-and-navigation',
    taskType: 'runtime-bridge',
    requiredProfiles: ['fast', 'e2e'],
    docs: { required: true },
  });
  expect(task.data.requiredRules).toEqual([
    'renderer-main-boundary',
    'attachment-access-safety',
    'tool-derived-file-safety',
    'ui-i18n-design-tokens',
    'office-preview-safety',
    'docs-sync',
  ]);
  expect(ruleIds).toContain('office-preview-safety');
  expect(workspaceScenario?.data.requiredRules).toContain('office-preview-safety');
  expect(workspaceScenario?.data.ownedPaths).toEqual(expect.arrayContaining([
    'src/components/file-preview/DocxViewer.tsx',
    'src/components/file-preview/PptxViewer.tsx',
    'src/pages/Chat/AcpTurnFileActivity.tsx',
    'src/pages/Chat/AcpAttachmentPart.tsx',
    'tests/e2e/office-document-preview.spec.ts',
  ]));
  expect(workspaceScenario?.body).toContain('DOCX');
  expect(workspaceScenario?.body).toContain('PPTX');
  expect(workspaceScenario?.body).toContain('20 MB');
  expect(workspaceScenario?.body).toContain('single mounted PPTX viewer');
  ```

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run:

  ```sh
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  ```

  Expected: failure because `office-document-preview.md` and `office-preview-safety.md` do not exist.

- [ ] **Step 3: Write the task, rule, scenario, and reference updates**

  `harness/specs/tasks/office-document-preview.md` must declare:

  - `scenario: chat-workspace-and-navigation`
  - `taskType: runtime-bridge`
  - `requiredProfiles: [fast, e2e]`
  - the six required rules asserted above
  - every production, locale, fixture, test, design, plan, harness, and README path from this plan under `touchedAreas`, including the active `src/pages/Chat/AcpTurnFileActivity.tsx` and `src/pages/Chat/AcpAttachmentPart.tsx` entry points even if their source does not require a format-specific branch
  - focused unit, typecheck, lint, Vite build, Office E2E, harness validate/run, and `harness:ci` commands under `requiredTests`
  - acceptance for exact formats, 20 MB limits, scoped access, disabled DOCX links, PPTX single-instance behavior, and four-locale coverage

  `harness/specs/rules/office-preview-safety.md` must record the format boundary, discriminated limits, no scoped fallback, Renderer-only parsing, React-lazy viewer loading, parser imports deferred until bytes arrive, DOCX active-content restrictions, PPTX global-state single-instance requirement, detachment of target-specific resources, release of ClawX-owned bytes/listeners/observers/timers, exactly-once public `destroy()`, and the accepted dependency-owned retained-resource limitation.

  Expand `chat-workspace-and-navigation.md` owned paths and required rules. Its body must explicitly state DOCX/PPTX preview acceptance, the 20 MB boundary, scoped-reference behavior, and the “single mounted PPTX viewer” invariant. Add a concise durable Office-preview section to `harness/reference/chat-workspace-and-navigation.md` and link it from the scenario body.

- [ ] **Step 4: Validate the harness contract**

  Run:

  ```sh
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  pnpm harness validate --spec harness/specs/tasks/office-document-preview.md
  ```

  Expected: both commands pass; validation selects `fast` and `e2e` without requiring the comms profile.

- [ ] **Step 5: Commit the task**

  ```sh
  git add harness/specs/tasks/office-document-preview.md harness/specs/rules/office-preview-safety.md harness/specs/scenarios/chat-workspace-and-navigation.md harness/reference/chat-workspace-and-navigation.md tests/unit/harness-specs.test.ts
  git commit -m "test: define Office preview harness contract"
  ```

---

### Task 2: Add Dependencies and Preview Capabilities

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `shared/file-preview/limits.ts`
- Modify: `src/lib/generated-files.ts`
- Modify: `src/lib/file-preview-capabilities.ts`
- Modify: `src/components/file-preview/open-file-utils.ts`
- Test: `tests/unit/generated-files.test.ts`
- Test: `tests/unit/open-file-utils.test.ts`

**Interfaces:**
- Consumes: Existing `FilePreviewKind`, `RichFilePreviewKind`, extension classifiers, and `attachmentOpenMode()`.
- Produces: `FILE_PREVIEW_MAX_OFFICE_BYTES`, rich kinds `docx`/`pptx`, `FilePreviewLimitTarget`, `filePreviewMaxBytes()`, format-aware `isFilePreviewWithinSizeLimit()`, `isDocxPreviewExt()`, and `isPptxPreviewExt()`.

- [ ] **Step 1: Write failing capability and fallback tests**

  Update `tests/unit/generated-files.test.ts` to assert:

  - `.docx` resolves to `rich`/`docx`; `.pptx` resolves to `rich`/`pptx`.
  - `.doc` and `.ppt` remain unsupported even with previewable MIME.
  - `.docx` and `.pptx` win over conflicting MIME.
  - Unknown/missing extensions do not become Office previews from OOXML MIME alone.
  - DOCX/PPTX MIME mappings are exact.
  - Text accepts 2 MB; Office accepts 20 MB; PDF/sheet accepts 50 MB; each rejects one byte above.
  - In-limit authorized local DOCX/PPTX attachments use `preview`; over-limit and remote targets use `system`.
  - `supportsInlineDiff()` remains false for all four Office extensions.

  Update `tests/unit/open-file-utils.test.ts` so `.docx`/`.pptx` are eligible for direct-open fallback only above the existing minimum, while `.doc`/`.ppt` remain excluded.

- [ ] **Step 2: Run the focused tests and verify failure**

  ```sh
  pnpm exec vitest run tests/unit/generated-files.test.ts tests/unit/open-file-utils.test.ts
  ```

  Expected: failures because DOCX/PPTX remain system-open-only and the Office limit/rich kinds do not exist.

- [ ] **Step 3: Install exact dependencies**

  Add renderer libraries following the repository's current placement:

  ```sh
  pnpm add -D docx-preview jszip chart.js
  pnpm add -D -E pptxviewjs@1.1.9
  ```

  Verify `package.json` records exactly `"pptxviewjs": "1.1.9"`, not a caret or tilde range.

- [ ] **Step 4: Implement extension, MIME, kind, and limit classification**

  In `shared/file-preview/limits.ts` add:

  ```ts
  export const FILE_PREVIEW_MAX_OFFICE_BYTES = 20 * 1024 * 1024;
  ```

  In `src/lib/generated-files.ts` add explicit DOCX/PPTX sets, predicates, and MIME mappings. Include them in inline/rich document support, but not text diff.

  In `src/lib/file-preview-capabilities.ts`:

  ```ts
  export type RichFilePreviewKind = 'image' | 'pdf' | 'sheet' | 'docx' | 'pptx';

  export type FilePreviewLimitTarget =
    | { kind: 'text' }
    | { kind: 'rich'; richKind: RichFilePreviewKind };

  export function filePreviewMaxBytes(target: FilePreviewLimitTarget): number;
  export function isFilePreviewWithinSizeLimit(
    target: FilePreviewLimitTarget,
    size: number,
  ): boolean;
  ```

  Dispatch supported extensions before MIME fallback. Remove only `.docx` and `.pptx` from `SYSTEM_OPEN_ONLY_EXTENSIONS`. Make `attachmentOpenMode()` resolve the exact rich kind before applying the discriminated limit.

  Add `.docx` and `.pptx` to `DIRECT_OPEN_FALLBACK_EXTS`; leave legacy formats excluded.

- [ ] **Step 5: Run focused and regression tests**

  ```sh
  pnpm exec vitest run tests/unit/generated-files.test.ts tests/unit/open-file-utils.test.ts tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx
  pnpm run typecheck:web
  ```

  Expected: all tests and Renderer typecheck pass; PDF/sheet expectations remain at 50 MB.

- [ ] **Step 6: Commit the task**

  ```sh
  git add package.json pnpm-lock.yaml shared/file-preview/limits.ts src/lib/generated-files.ts src/lib/file-preview-capabilities.ts src/components/file-preview/open-file-utils.ts tests/unit/generated-files.test.ts tests/unit/open-file-utils.test.ts
  git commit -m "feat: classify DOCX and PPTX previews"
  ```

---

### Task 3: Implement the DOCX Viewer

**Files:**
- Create: `src/components/file-preview/DocxViewer.tsx`
- Create: `tests/unit/office-file-viewers.test.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

**Interfaces:**
- Consumes: `AttachmentFileRef`, `WorkspaceFileRef`, three binary-read helpers, `FILE_PREVIEW_MAX_OFFICE_BYTES`, `getFilePreviewTargetIdentity()`, and `docx-preview.renderAsync()`.
- Produces: Default-exported `DocxViewer` with `OfficeViewerProps`, stable test IDs `docx-viewer` and `docx-preview-host`, and localized `filePreview.docx.loadFailed`.

- [ ] **Step 1: Write failing DOCX viewer tests**

  In `tests/unit/office-file-viewers.test.tsx`, mock `docx-preview`, the three binary-read functions, `ResizeObserver`, and element measurements. Cover:

  - ordinary, workspace-scoped, and attachment-scoped reads pass the 20 MB maximum and never cross-fallback;
  - simultaneous `attachmentFileRef` and `workspaceFileRef` produces a generic error before any read;
  - `renderAsync()` receives detached body/style elements and all exact options from the design;
  - rendered containers attach to an open Shadow Root only after the current identity finishes;
  - a stale render cannot mutate the visible target;
  - capturing anchor clicks prevents default for hash, HTTP, file, and custom schemes;
  - width scaling never exceeds zoom `1` and observer cleanup runs;
  - `tooLarge`, read failure, parse failure, and empty data show localized generic states without parser details;
  - unmount clears generated DOM and direct byte references.

- [ ] **Step 2: Run the focused test and verify failure**

  ```sh
  pnpm exec vitest run tests/unit/office-file-viewers.test.tsx
  ```

  Expected: module-not-found failure for `DocxViewer`.

- [ ] **Step 3: Add four-locale DOCX failure text**

  Add `filePreview.docx.loadFailed` to all four `chat.json` files. Use a generic message equivalent to “Word document failed to load”; do not interpolate the raw parser exception.

- [ ] **Step 4: Implement scoped loading and detached Shadow DOM rendering**

  `DocxViewer` must reject dual scoped refs, choose exactly one binary-read path, and use a target identity/cancellation generation. Dynamically import `docx-preview` only after bytes arrive.

  Render with:

  ```ts
  {
    className: 'clawx-docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderChanges: false,
    renderComments: false,
    renderAltChunks: false,
    useBase64URL: true,
    experimental: false,
    debug: false,
  }
  ```

  Create new detached body/style containers per identity, attach only the current completed pair to the Shadow Root, inject paper/surface CSS inside that root, disable every anchor default action, and use `ResizeObserver` to set a Chromium CSS zoom of `Math.min(1, availableWidth / widestPageWidth)`.

- [ ] **Step 5: Run focused and locale tests**

  ```sh
  pnpm exec vitest run tests/unit/office-file-viewers.test.tsx tests/unit/i18n-locale-parity.test.ts
  pnpm run typecheck:web
  ```

  Expected: all DOCX routing, isolation, error, cleanup, and locale tests pass.

- [ ] **Step 6: Commit the task**

  ```sh
  git add src/components/file-preview/DocxViewer.tsx tests/unit/office-file-viewers.test.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json
  git commit -m "feat: add isolated DOCX preview viewer"
  ```

---

### Task 4: Implement the PPTX Viewer

**Files:**
- Create: `src/components/file-preview/PptxViewer.tsx`
- Modify: `tests/unit/office-file-viewers.test.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

**Interfaces:**
- Consumes: The same authorized binary-read inputs as DOCX and `PPTXViewer` from `pptxviewjs@1.1.9`.
- Produces: Default-exported `PptxViewer`, `PptxViewerProps`, stable test IDs `pptx-viewer` and `pptx-canvas`, and localized previous/next/position/failure labels.

  ```ts
  export interface PptxViewerProps extends OfficeViewerProps {
    initialSlideIndex?: number;
    onSlideIndexChange?: (index: number) => void;
  }
  ```

- [ ] **Step 1: Write failing PPTX lifecycle and scheduler tests**

  Extend `tests/unit/office-file-viewers.test.tsx` with a controllable `pptxviewjs` mock. Cover:

  - all three read routes and dual-ref rejection;
  - construction options include `enableThumbnails: false`, `slideSizeMode: 'fit'`, `backgroundColor: '#ffffff'`, and `autoChartRerenderDelayMs: 0`;
  - initial render waits for positive dimensions, applies Canvas CSS width/height, and starts at slide zero;
  - `initialSlideIndex` restores and clamps after `getSlideCount()`;
  - display is one-based and previous/next boundaries disable correctly;
  - initial, restore, navigation, resize, and chart events run through one serialized queue and skip obsolete generations;
  - resize uses a 100 ms trailing debounce;
  - `chartRenderingComplete` events coalesce while a chart refresh is pending and listeners are removed on cleanup;
  - navigation is disabled during rendering and `onSlideIndexChange` fires only after successful current renders;
  - `destroy()` runs exactly once, ClawX observers/timers/listeners are removed, and stale Canvas is detached;
  - development single-instance assertion fails on a second concurrent mount but tolerates normal Strict Mode cleanup;
  - failures render generic localized text without raw exceptions.

- [ ] **Step 2: Run the focused test and verify failure**

  ```sh
  pnpm exec vitest run tests/unit/office-file-viewers.test.tsx
  ```

  Expected: failures because `PptxViewer` and its controls do not exist.

- [ ] **Step 3: Add PPTX strings in all locales**

  Add:

  ```text
  filePreview.pptx.loadFailed
  filePreview.pptx.previous
  filePreview.pptx.next
  filePreview.pptx.slidePosition
  ```

  Preserve `{{current}}` and `{{total}}` interpolation in every locale.

- [ ] **Step 4: Implement loading, sizing, and one render scheduler**

  Dynamically import `pptxviewjs` after the authorized 20 MB read. Create a target-specific Canvas and viewer instance. Use a generation counter plus a Promise-chain scheduler; every render request carries target generation, requested slide, and latest dimensions and is skipped when obsolete.

  Add a bounded helper equivalent to:

  ```ts
  async function waitForPositiveSize(element: HTMLElement, maxFrames = 60) {
    // Check clientWidth/clientHeight, otherwise await requestAnimationFrame.
  }
  ```

  Synchronize Canvas CSS dimensions before every queued render. Observe the container with a 100 ms trailing debounce. Listen to the global `chartRenderingComplete` event, coalesce pending chart refreshes, and submit them to the same queue. Never use `loadFromUrl()`.

  Add a module-level development-only active-instance assertion. Document in the code that `pptxviewjs@1.1.9` shares chart/ZIP globals and link to the design's “Single active instance” section.

- [ ] **Step 5: Run focused, locale, and type tests**

  ```sh
  pnpm exec vitest run tests/unit/office-file-viewers.test.tsx tests/unit/i18n-locale-parity.test.ts
  pnpm run typecheck:web
  ```

  Expected: all PPTX tests pass, no timers/listeners remain after cleanup, and locale interpolation is valid.

- [ ] **Step 6: Commit the task**

  ```sh
  git add src/components/file-preview/PptxViewer.tsx tests/unit/office-file-viewers.test.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json
  git commit -m "feat: add single-instance PPTX preview viewer"
  ```

---

### Task 5: Integrate Office Viewers into Active Preview Surfaces

**Files:**
- Modify: `src/components/file-preview/FilePreviewBody.tsx`
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx`
- Modify: `src/components/file-preview/ArtifactPanel.tsx`
- Modify: `src/components/file-preview/build-preview-target.ts`
- Test: `tests/unit/file-preview-body.test.tsx`
- Test: `tests/unit/workspace-browser-body.test.tsx`
- Test: `tests/unit/artifact-panel.test.tsx`
- Test: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: `DocxViewer`, `PptxViewer`, `filePreviewMaxBytes()`, `isFilePreviewWithinSizeLimit()`, DOCX/PPTX extension predicates, and active ACP targets.
- Produces: `FilePreviewBody` PPTX visibility/position inputs, `WorkspaceBrowserBody.active`, preserved per-target slide positions, and conditional mount behavior that enforces one PPTX instance.

- [ ] **Step 1: Write failing surface-routing and mount-lifecycle tests**

  Add or update tests to verify:

  - `FilePreviewBody` lazy-dispatches DOCX/PPTX and never performs a text read for either;
  - a known 20 MB + 1 local Office file does not mount a parser and offers existing direct-open/reveal actions;
  - a `WorkspaceFileRef` over the limit shows `tooLarge` without shell actions;
  - `WorkspaceBrowserBody` stats Office files before viewer dispatch, keeps PDF/sheet ordering unchanged, and suppresses the Office parser when over-limit;
  - Workspace Browser passes its validated absolute path, not a fabricated `WorkspaceFileRef`;
  - `ArtifactPanel` keeps Workspace state mounted but passes `active={false}` while Preview is visible;
  - hidden Workspace/Preview tabs do not mount their PPTX child;
  - switching tabs never yields two `pptx-viewer` roots and restores a clamped saved index after reparse;
  - `AcpTurnFileActivity` opens DOCX/PPTX as `WorkspaceFileRef` Preview targets;
  - `AcpAttachmentPart` previews in-limit authorized DOCX/PPTX and calls scoped `openAttachment()` for 20 MB + 1 or remote targets;
  - existing PDF/sheet attachment expectations remain unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

  ```sh
  pnpm exec vitest run tests/unit/file-preview-body.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/acp-chat-components.test.tsx
  ```

  Expected: failures because the new rich kinds are not dispatched and hidden PPTX content remains mounted.

- [ ] **Step 3: Integrate lazy viewers and format-aware preflight**

  In `FilePreviewBody.tsx` lazy-import both viewers, classify Office as binary rich previews, use the discriminated format limit for preflight/stat results, and dispatch without Source or Diff tabs.

  Add explicit inputs for PPTX visibility and position ownership, for example:

  ```ts
  interface FilePreviewBodyProps {
    // existing props...
    active?: boolean;
    initialPptxSlideIndex?: number;
    onPptxSlideIndexChange?: (index: number) => void;
  }
  ```

  Default `active` to true for existing callers. Only conditionally mount the PPTX branch; do not unmount unrelated viewers.

  Update `buildAttachmentPreviewTarget()`'s document mapping so both new rich kinds produce `contentType: 'document'` explicitly, while extension classification remains the fallback.

- [ ] **Step 4: Preserve tab state while conditionally mounting PPTX**

  Add `active?: boolean` to `WorkspaceBrowserBody`, defaulting to true. Keep a `Map<string, number>` keyed by `getFilePreviewTargetIdentity({ filePath: selectedNode.absPath })`. Mount `PptxViewer` only when active; retain tree selection/expansion because the whole browser component stays mounted.

  In `ArtifactPanel`, pass `visibleTab === 'browser'` and `visibleTab === 'preview'` to the two surfaces. Keep a position map in `PreviewTab` keyed by the focused target identity and pass initial/change values through `FilePreviewBody`.

  At each conditional PPTX mount, keep a succinct comment stating that CSS `hidden` is insufficient because `pptxviewjs@1.1.9` uses Renderer-global processor/ZIP state; reference `docs/specs/2026-07-22-office-document-preview-design.md#single-active-instance`.

- [ ] **Step 5: Run focused and regression tests**

  ```sh
  pnpm exec vitest run \
    tests/unit/generated-files.test.ts \
    tests/unit/file-preview-body.test.tsx \
    tests/unit/workspace-browser-body.test.tsx \
    tests/unit/artifact-panel.test.tsx \
    tests/unit/acp-chat-components.test.tsx \
    tests/unit/rich-file-viewers.test.tsx \
    tests/unit/office-file-viewers.test.tsx
  pnpm run typecheck:web
  ```

  Expected: all active routes preview supported Office files, scoped targets never fall back, only one PPTX root mounts, and existing rich viewers remain green.

- [ ] **Step 6: Commit the task**

  ```sh
  git add src/components/file-preview/FilePreviewBody.tsx src/components/file-preview/WorkspaceBrowserBody.tsx src/components/file-preview/ArtifactPanel.tsx src/components/file-preview/build-preview-target.ts tests/unit/file-preview-body.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/acp-chat-components.test.tsx
  git commit -m "feat: integrate Office previews into artifact panel"
  ```

---

### Task 6: Add Real Electron Office Preview Coverage

**Files:**
- Create: `tests/e2e/office-document-preview.spec.ts`
- Create: `tests/e2e/fixtures/office/sample.docx`
- Create: `tests/e2e/fixtures/office/slides-a.pptx`
- Create: `tests/e2e/fixtures/office/slides-b.pptx`
- Modify: `tests/e2e/fixtures/electron.ts` only if a reusable binary-fixture helper is required

**Interfaces:**
- Consumes: `AttachmentHostFixture.createWorkspaceFile()`, ACP replay/file-activity helpers, the real packaged Host API file access, and real `docx-preview`/`pptxviewjs` bundles.
- Produces: Deterministic DOCX/PPTX fixtures and an Electron regression proving actual rendering, navigation, resize, scoped access, and single-instance behavior.

- [ ] **Step 1: Add deterministic fixtures and the failing E2E**

  Create small fixtures with no confidential content:

  - `sample.docx`: heading, paragraph, table, page break, header, and footer.
  - `slides-a.pptx`: two visually distinct slides; include one supported Chart.js chart.
  - `slides-b.pptx`: a different color/content deck used to detect cross-presentation globals.

  The E2E must:

  - create/copy fixtures into the isolated workspace;
  - open DOCX from Workspace and assert rendered text plus page structure;
  - open PPTX and assert `1 / 2`, positive Canvas dimensions, and non-transparent pixel data;
  - click Next/Previous and compare pixel digests plus disabled controls;
  - open one deck in Workspace and another through `AcpTurnFileActivity` Preview, switch tabs, assert at most one `pptx-viewer`, and confirm each deck's expected pixel digest;
  - navigate away and back, assert reparse restores the stored slide index;
  - resize the artifact panel to its minimum supported width and assert Canvas dimensions update after the debounce;
  - assert recorded access uses Host API and no legacy direct IPC path.

- [ ] **Step 2: Build and run the E2E to expose missing fixture/integration behavior**

  ```sh
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/office-document-preview.spec.ts
  ```

  Expected before final fixture/test adjustments: focused failures identify real-library rendering, selectors, or fixture compatibility rather than mocked Viewer behavior.

- [ ] **Step 3: Make the smallest fixture and E2E-support corrections**

  Correct OOXML fixture compatibility, stable selectors, and existing fixture wiring only. Do not add thumbnails, zoom, keyboard navigation, or production-only test hooks.

- [ ] **Step 4: Run real-library and attachment regressions**

  ```sh
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/office-document-preview.spec.ts tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-file-changes.spec.ts
  ```

  Expected: Office E2E and existing ACP attachment/file-activity E2Es pass with no two concurrently mounted PPTX viewers.

- [ ] **Step 5: Commit the task**

  ```sh
  git add tests/e2e/office-document-preview.spec.ts tests/e2e/fixtures/office/sample.docx tests/e2e/fixtures/office/slides-a.pptx tests/e2e/fixtures/office/slides-b.pptx tests/e2e/fixtures/electron.ts
  git commit -m "test: cover Office document previews end to end"
  ```

---

### Task 7: Update Documentation and Run Full Validation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `harness/specs/tasks/office-document-preview.md` if final exact test paths differ
- Modify: `harness/specs/rules/office-preview-safety.md` only if implementation names differ from the approved contract
- Modify: `harness/specs/scenarios/chat-workspace-and-navigation.md` only if final owned paths differ
- Modify: `harness/reference/chat-workspace-and-navigation.md` only if final names differ

**Interfaces:**
- Consumes: Completed implementation and exact validation commands from Tasks 1-6.
- Produces: User-facing documentation synchronized in three languages and a fully validated, implementation-accurate harness contract.

- [ ] **Step 1: Update all three READMEs**

  In each README's Chat/right-panel and ACP attachment sections, document:

  - read-only `.docx` and `.pptx` preview;
  - `.doc` and `.ppt` remain external/system formats;
  - DOCX pagination may differ from Microsoft Word;
  - PPTX animation, transition, and media playback are unsupported;
  - files above 20 MB do not preview inline.

  Keep wording equivalent across English, Chinese, and Japanese. Do not modify document-processing-skill descriptions unrelated to file preview.

- [ ] **Step 2: Run focused unit and harness checks**

  ```sh
  pnpm exec vitest run \
    tests/unit/generated-files.test.ts \
    tests/unit/open-file-utils.test.ts \
    tests/unit/file-preview-body.test.tsx \
    tests/unit/workspace-browser-body.test.tsx \
    tests/unit/rich-file-viewers.test.tsx \
    tests/unit/office-file-viewers.test.tsx \
    tests/unit/artifact-panel.test.tsx \
    tests/unit/acp-chat-components.test.tsx \
    tests/unit/i18n-locale-parity.test.ts \
    tests/unit/harness-specs.test.ts
  pnpm harness validate --spec harness/specs/tasks/office-document-preview.md
  pnpm harness run --spec harness/specs/tasks/office-document-preview.md
  pnpm run harness:ci
  ```

  Expected: every command passes. If the harness reports an owned-path mismatch, update the task/scenario to the actual intended files rather than using `--no-diff`.

- [ ] **Step 3: Run repository validation**

  ```sh
  pnpm run typecheck
  pnpm run lint:check
  pnpm test
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/office-document-preview.spec.ts tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-file-changes.spec.ts
  ```

  Expected: typecheck, lint, the complete unit suite, Vite build, and relevant Electron E2Es pass. Re-run any command affected by a fix.

- [ ] **Step 4: Verify final scope and accepted risks**

  Confirm with searches and diff review:

  - no `.doc`/`.ppt` parser route exists;
  - no new direct IPC, Renderer filesystem call, document `fetch()`, or Gateway path exists;
  - no PPTX thumbnails, zoom, keyboard, animation, media, or fullscreen feature was added;
  - conditional PPTX mount comments mention shared global state and the design;
  - `pptxviewjs` remains pinned to exactly `1.1.9`;
  - the accepted dependency-level retained-resource limitation remains documented and was not hidden by tests.

- [ ] **Step 5: Commit the task**

  ```sh
  git add README.md README.zh-CN.md README.ja-JP.md harness/specs/tasks/office-document-preview.md harness/specs/rules/office-preview-safety.md harness/specs/scenarios/chat-workspace-and-navigation.md harness/reference/chat-workspace-and-navigation.md
  git commit -m "docs: document Office preview support"
  ```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-22-office-document-preview.md`. Next use `subagent-driven-development` to execute Tasks 1-7 in order, preserving each task's test-first and commit boundary.

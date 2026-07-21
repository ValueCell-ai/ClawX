# Office Document Preview Design

Date: 2026-07-22
Status: Approved for implementation planning

## Summary

Add read-only DOCX and PPTX previews to ClawX's existing file-preview surfaces.
DOCX files render as scrollable paper pages with `docx-preview`. PPTX files
render one slide at a time to Canvas with `pptxviewjs` and provide simple
previous/next navigation.

Both formats use the existing sandboxed binary-read paths and render entirely
in the Renderer. The feature does not add a Main-process conversion service,
upload documents, or create temporary files.

## Goals

- Preview `.docx` files in the right-side workspace browser and Preview panel.
- Preview `.pptx` files in the same surfaces with basic slide navigation.
- Apply the same capability to local or authorized attachments that already use
  ClawX's file-preview pipeline.
- Keep document bytes inside the existing Host API file-access boundaries.
- Avoid increasing initial chat-surface loading cost by lazy-loading both
  viewers and their parsing dependencies.
- Bound compressed Office document input to 20 MB before parsing.
- Preserve the existing behavior of unrelated preview formats.

## Non-goals

- Previewing legacy binary `.doc` or `.ppt` files.
- Converting legacy Office formats to OOXML.
- Editing or saving Word documents or PowerPoint presentations.
- Pixel-identical layout compared with Microsoft Office.
- Word search, table of contents, comments, tracked changes, or editing tools.
- PowerPoint thumbnails, animation, transitions, media playback, fullscreen,
  presenter view, or automatic slide shows.
- Main-process, server-side, cloud, or external-service document conversion.
- Downloading remote attachments specifically for preview.
- Changing the existing generated-file-card behavior for PDF or spreadsheet
  files.

## Supported Formats

The new inline capabilities are determined by extension:

| Extension | MIME type | Preview kind | Library |
| --- | --- | --- | --- |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `docx` | `docx-preview` |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `pptx` | `pptxviewjs` |

`.doc` and `.ppt` remain classified as documents for file display, but remain
system-open-only formats. MIME alone must not opt a legacy or unknown extension
into an OOXML parser.

## Dependencies

Add these packages following the repository's existing dependency placement:

- `docx-preview` for DOCX-to-HTML rendering.
- Exactly `pptxviewjs@1.1.9` for PPTX parsing and Canvas rendering. This version
  is pinned because the single-instance and accepted-retention decisions depend
  on its reviewed global-state and lifecycle behavior.
- `jszip` as the required `pptxviewjs` peer dependency and the ZIP parser used
  by both libraries.
- `chart.js` to render charts embedded in PPTX presentations.

The selected `pptxviewjs` ESM build imports `chart.js/auto` and `jszip` directly.
Both viewer components must therefore be loaded through React lazy imports so
these packages do not join the synchronous chat entry chunk.

## Capability Model

Extend `RichFilePreviewKind` with two values:

```ts
type RichFilePreviewKind = 'image' | 'pdf' | 'sheet' | 'docx' | 'pptx';
```

The generated-file helpers own explicit DOCX and PPTX extension sets, MIME
mappings, and predicates in the same manner as the existing PDF and sheet sets.
`supportsRichDocumentPreview()` returns true for both new formats.

Remove `.docx` and `.pptx` from `SYSTEM_OPEN_ONLY_EXTENSIONS`. Keep `.doc` and
`.ppt` in that set. This causes `filePreviewKind()` to return `rich` only for the
new OOXML formats and leaves legacy formats on the existing unsupported path.

## Size Policy

Add a shared constant:

```ts
export const FILE_PREVIEW_MAX_OFFICE_BYTES = 20 * 1024 * 1024;
```

DOCX and PPTX previews use this limit instead of the existing 50 MB generic
binary-preview limit. The limit applies to the compressed input size before the
Host API returns bytes to the Renderer. It reduces, but cannot eliminate, ZIP
expansion risk; the viewers must still handle parser failures without retry
loops or renderer crashes.

The capability layer exposes one format-aware size decision so attachment cards,
`FilePreviewBody`, and `WorkspaceBrowserBody` do not duplicate limit logic.
Known DOCX or PPTX files over 20 MB do not enter inline preview. Ordinary local
and attachment targets use their authorized system-open flows; workspace-scoped
Preview targets show `tooLarge` without a naked-path fallback. Unknown-size
files are read with `maxBytes` set to 20 MB, allowing the existing Host API to
return `tooLarge` without transferring their contents.

The format-aware API accepts the resolved preview kind and file size:

```ts
type FilePreviewLimitTarget =
  | { kind: 'text' }
  | { kind: 'rich'; richKind: RichFilePreviewKind };

filePreviewMaxBytes(target: FilePreviewLimitTarget): number
isFilePreviewWithinSizeLimit(target: FilePreviewLimitTarget, size: number): boolean
```

The discriminated input makes `richKind` mandatory for every rich preview; an
unresolved rich format fails closed rather than receiving a default. The
complete limit table is 2 MB for text, 20 MB for DOCX/PPTX, and 50 MB for
image/PDF/sheet previews. Callers use these helpers rather than importing a raw
limit when deciding whether a target can preview.

Add `.docx` and `.pptx` to the direct-open fallback extension set. The direct
open action is shown only after the Office limit is exceeded and only when the
caller owns an ordinary local path. Scoped attachment targets do not fall back
to a naked path.

PDF and spreadsheet limits remain unchanged.

This limit is a product performance guard, not a complete malicious-ZIP
security boundary. Entry-count, expansion-ratio, and XML-complexity preflight
are outside the first release. Files from authorized paths and attachments are
still treated as potentially malformed, and parser failures must remain
contained to the preview error state.

## Architecture

### Renderer-only parsing

`DocxViewer` and `PptxViewer` live beside `PdfViewer` and `SheetViewer` under
`src/components/file-preview/`. They receive the same target fields:

```ts
interface OfficeViewerProps {
  filePath: string;
  fileName?: string;
  attachmentFileRef?: AttachmentFileRef;
  workspaceFileRef?: WorkspaceFileRef;
  className?: string;
}

interface PptxViewerProps extends OfficeViewerProps {
  initialSlideIndex?: number;
  onSlideIndexChange?: (index: number) => void;
}
```

Each viewer selects exactly one existing read path:

| Target | Read operation |
| --- | --- |
| Ordinary local file | `readBinaryFile(filePath, { maxBytes })` |
| Explicit workspace reference | `readWorkspaceBinary({ ...workspaceFileRef, maxBytes })` |
| Attachment-scoped file | `readAttachmentBinary(attachmentFileRef, maxBytes)` |

The Renderer never calls `fetch()` for document contents and never retries a
scoped read through `filePath`. No Host API contract or transport changes are
needed.

`WorkspaceBrowserBody` currently owns an absolute path that has already been
resolved under the active workspace and continues through `readBinaryFile()`.
This design does not migrate that existing browser flow to `WorkspaceFileRef`.
Targets supplied elsewhere with `workspaceFileRef` continue to use the scoped
workspace read. If both scoped references are present, the viewer rejects the
target as invalid, performs no read, and shows the generic load-failure state.
An ordinary path is used only when neither scoped reference exists.

### Lifecycle

Both viewers derive an identity with `getFilePreviewTargetIdentity()`. Every
read and render operation captures that identity and a cancellation flag.
Results are committed only while both still match the mounted target. Because
the libraries do not expose operation cancellation, each load renders into
new target-specific resources rather than reusing the visible DOM or Canvas.

Changing targets performs these steps in order:

1. Mark the previous operation cancelled.
2. Detach the previous target-specific DOM or Canvas and invoke its public
   cleanup API where available.
3. Reset state to loading.
4. Read bytes through the target's one authorized binary path.
5. Lazy-load and invoke the format library against detached target-specific
   render resources.
6. Attach those resources and commit ready state only if the target is still
   current.

This prevents late reads or renders from replacing the currently selected
file.

## DOCX Viewer

### Rendering

`DocxViewer` calls `renderAsync()` with the returned `Uint8Array`. The rendered
body and style containers are ordinary elements inside a Shadow Root attached
to the React-owned host. The Shadow Root isolates generated document styles
from ClawX and prevents application styles from rewriting the document layout.

Use these explicit options:

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

Disabling `renderAltChunks` prevents embedded HTML parts from entering the host
document. Base64 resource URLs avoid unreclaimed library-created Blob URLs; all
generated markup and resource strings are released when the Shadow Root
containers are cleared.

### Layout

Pages appear as centered white paper sheets on the existing preview surface and
scroll vertically. The viewer preserves page width, height, orientation,
headers, and footers from the document.

A `ResizeObserver` measures the available preview width and the widest rendered
page. Electron Chromium's CSS `zoom` scales the document down when necessary,
with a maximum zoom of `1`. Documents are never enlarged above their authored
size. Scaling includes page dimensions and vertical flow, avoiding transformed
content overlapping later pages.

`docx-preview` depends on page-break information stored in the document and
does not perform Word's full real-time pagination algorithm. Small layout and
page-break differences are accepted limitations and must be documented.

### Links

The first release treats DOCX links as non-interactive preview content. A
capturing Shadow Root click handler prevents the default action for every
anchor, including hash, external, file, and custom-protocol links. This avoids
navigating the ClawX window and avoids broadening the existing shell Host API.
Opening DOCX links is a non-goal.

## PPTX Viewer

### Rendering

`PptxViewer` creates one `PPTXViewer` instance with a target-specific canvas,
calls `loadFile(Uint8Array)`, and renders slide index zero. The presentation is
parsed once while that target remains active. Resizing or slide navigation
renders from the loaded instance without rereading or reparsing the file.

The canvas is centered on the preview surface and preserves the source slide's
aspect ratio. A `ResizeObserver` requests a current-slide render when the panel
size changes. The instance is constructed with `enableThumbnails: false`,
`slideSizeMode: 'fit'`, and a React-owned Canvas whose CSS dimensions are
bounded by the available surface.

Before the initial render, the component waits for the Canvas container to
report positive width and height, retrying on animation frames for a bounded
number of frames. It then sets the Canvas CSS width and height from the current
container dimensions before invoking `render()`. This avoids rendering against
the zero-sized layout that can occur immediately after opening the artifact
panel or changing tabs.

The `ResizeObserver` uses a 100 ms trailing debounce. After the debounce it
re-reads the current container dimensions, synchronizes the Canvas CSS size,
and submits a resize render to the shared scheduler. It does not render directly
from the observer callback.

### Controls

A compact bottom control bar contains:

1. Previous slide button.
2. Localized `current / total` slide label using one-based display numbers.
3. Next slide button.

The previous button is disabled on the first slide and the next button is
disabled on the last slide. Both are disabled while a render is in progress.
Initial, restore, navigation, chart-complete, and resize renders all enter one
serialized scheduler. Before executing a queued request, the scheduler checks
the target generation and latest requested slide/size and skips obsolete work.
No independent resize render may bypass this scheduler.

Set `autoChartRerenderDelayMs: 0` to disable the library's uncancellable delayed
render. The component listens for the library's chart-complete signal and queues
a debounced current-slide refresh through the same owned scheduler. Events that
arrive while a chart refresh is pending are coalesced; later chart completions
may request another refresh. Once parsed chart data is present, rendering it
does not emit another completion event, avoiding a render loop. The listener is
removed on target change or unmount.

A target identity with no stored position starts on slide zero. The owning
surface passes a previously stored `initialSlideIndex` only when returning to
the same identity; the viewer clamps it to the loaded slide range and reports
successful navigation through `onSlideIndexChange`.

The first release has no keyboard shortcuts because focus and shortcut
ownership in the right sidebar are not otherwise defined for document previews.

### Single active instance

`pptxviewjs@1.1.9` exposes chart relationship data through process-global
`window.currentProcessor` and `window.currentZipData`. ClawX therefore enforces
an invariant that at most one `PptxViewer` is mounted at a time.

This restriction is required because Workspace and Preview live in the same
Electron Renderer and are normally kept mounted while inactive with CSS
`hidden`. Two mounted viewers would overwrite the same library globals and could
resolve chart or ZIP resources from the wrong presentation. This is a
correctness constraint, not merely a rendering-performance optimization.

`ArtifactPanel` continues mounting `WorkspaceBrowserBody` so its tree expansion,
selection, and scroll state survive tab changes. It passes whether Workspace is
the visible tab, and the browser mounts its selected PPTX viewer only while
visible. The Preview tab likewise mounts its PPTX viewer only while Preview is
visible. A development assertion and a real-library regression test protect the
single-instance invariant.

The implementation must keep a succinct comment at the conditional PPTX mount
site explaining the shared-global-state reason and pointing to this design
section. Future refactors must not replace conditional mounting with CSS-only
hiding unless `pptxviewjs` no longer uses presentation globals and the
multi-presentation regression test proves isolation.

Switching away unmounts the viewer, detaches its Canvas, and drops ClawX's direct
reference to the parsed presentation. The owning surface stores the current
slide index by target identity. Switching back reparses the file and restores
that index after load. Dependency-owned references may remain as described in
Cleanup. This trades repeated parsing for deterministic active global-state
ownership.

### Cleanup

On target change or unmount, `PPTXViewer.destroy()` is called exactly once for
the active instance. ClawX-owned event listeners, pending animation frames, and
resize observers are removed, and the target-specific canvas is detached.

The published `pptxviewjs@1.1.9` `destroy()` does not call its internal cache
cleanup, cancel its internal delayed chart render, or clear chart-related global
processor/ZIP references. The first release accepts that dependency-level
resource-retention risk and does not patch the package. The single-instance
mounting rule prevents concurrent presentations from using those globals, but
does not claim complete resource reclamation after repeated file switches.

## Preview Surface Integration

### FilePreviewBody

`FilePreviewBody` lazy-loads both viewers alongside `PdfViewer` and
`SheetViewer`. The preview tab dispatches `docx` to `DocxViewer` and `pptx` to
`PptxViewer`. These formats remain read-only and never receive Source or Diff
tabs.

Its preflight size check uses the format-aware maximum. A known over-limit local
file uses the existing direct-open confirmation and file-manager actions.

### WorkspaceBrowserBody

The workspace browser recognizes DOCX and PPTX as dedicated rich formats before
the text-read branch. It stats the selected file, applies the 20 MB limit, and
mounts the corresponding lazy viewer. It must not call `readTextFile()` for
either format. Office loading and over-limit states are checked before Office
viewer dispatch, so a known over-limit Office file never mounts a parser.

The Office branches use the shared format-aware size helper. Existing PDF and
sheet branch ordering and behavior remain unchanged in this project; correcting
their existing preflight behavior is a separate concern.

### Attachments

`attachmentOpenMode()` uses the same format-aware 20 MB decision. Authorized
local attachment references at or below the limit open in the Preview panel and
read through `readAttachmentBinary()`. Over-limit or remote attachment targets
continue through scoped `openAttachment()` system-open behavior. No download
flow is added.

### Generated and referenced files

The active ACP generated-file surface is `AcpTurnFileActivity`; it already opens
non-deleted workspace files through a `WorkspaceFileRef` Preview target and
gains DOCX/PPTX rendering from the capability change. `AcpAttachmentPart`
continues to route available attachment references through
`attachmentOpenMode()` and opens eligible files in Preview.

The legacy `GeneratedFilesPanel` and `ChatMessage` are not production entry
points and are not changed or tested by this project. Existing PDF and
spreadsheet interactions remain unchanged.

## Loading and Errors

Both viewers use these states:

- `loading`: the file is being read, the library is loading, or initial render
  is running.
- `ready`: document pages or the active slide and controls are visible.
- `tooLarge`: the Host API reports a file beyond the 20 MB limit.
- `error`: reading, parsing, or rendering failed.

Loading uses the existing spinner. Error messages are localized per format and
do not display stack traces. Expected unsupported inputs include corrupt,
encrypted, password-protected, and malformed OOXML files.

Over-limit behavior depends on target authority:

| Target | Over-limit behavior |
| --- | --- |
| Workspace Browser ordinary path | Confirmed direct open and reveal actions |
| Authorized attachment reference | Existing scoped `openAttachment()` system-open flow |
| `WorkspaceFileRef` Preview target | `tooLarge` state without naked-path shell actions |

Closing and reopening or reselecting a failed preview starts a new load; no
automatic retry loop is added.

`.doc` and `.ppt` continue to show the existing unsupported-format surface.

## Security and Resource Boundaries

- Document data is read only through existing Host API methods.
- When a `WorkspaceFileRef` or `AttachmentFileRef` is supplied, it remains
  scoped and never falls back to a raw path. The Workspace Browser retains its
  existing Host-validated absolute-path flow by explicit design.
- ClawX passes `Uint8Array` input and never invokes either library's URL-loading
  API. Test fixtures contain only embedded resources.
- DOCX generated CSS and DOM are isolated in a Shadow Root.
- DOCX `altChunk`, comments, and tracked changes are disabled.
- All DOCX anchor default actions are disabled, so links cannot navigate the
  ClawX BrowserWindow.
- PPTX output is inert Canvas content; presentation actions, scripts, and media
  playback are not executed.
- Both formats enforce the 20 MB compressed-input limit before parsing.
- Library code is excluded from the initial entry chunk. ClawX detaches
  per-document DOM/Canvas and drops its direct references to listeners,
  observers, and byte buffers when the target changes or the preview unmounts.
- Complete disposal of `pptxviewjs` internal caches, delayed work, and globals is
  explicitly not guaranteed in the first release.

## Internationalization and Styling

All new user-visible strings use the `chat` namespace in all four locale files:

- `shared/i18n/locales/en/chat.json`
- `shared/i18n/locales/zh/chat.json`
- `shared/i18n/locales/ja/chat.json`
- `shared/i18n/locales/ru/chat.json`

New strings cover DOCX/PPTX load failures and PPTX previous, next, and slide
position labels. Existing generic loading, size, direct-open, and file-manager
strings are reused.

Viewer chrome uses the tokens and substitutions documented in
`src/styles/globals.css`. Document paper and PPTX Canvas content retain their
authored colors; surrounding surfaces, controls, borders, and states follow the
active ClawX theme.

## Testing

### Unit tests

Capability tests verify:

- `.docx` resolves to `rich` and `docx`.
- `.pptx` resolves to `rich` and `pptx`.
- `.doc` and `.ppt` remain unsupported inline.
- DOCX and PPTX MIME mappings are correct.
- The Office limit accepts exactly 20 MB and rejects 20 MB plus one byte.
- PDF and sheet limits remain unchanged.
- Attachment mode chooses preview only for authorized, in-limit targets.

Viewer tests mock the parsing libraries and verify:

- Each target type uses only its authorized binary read function.
- Reads pass the 20 MB maximum.
- DOCX options include style isolation and unsafe-feature restrictions.
- DOCX cleanup removes generated content and stale renders do not commit.
- PPTX starts on slide zero and displays one-based status.
- PPTX button states, one scheduler for every render source, slide restoration,
  chart-complete handling, and `destroy()` behavior are correct.
- Supplying both scoped reference types fails before any binary read.
- Read, parse, render, and over-limit failures produce localized states.

Integration-level component tests verify:

- `FilePreviewBody` dispatches both new rich preview kinds.
- `WorkspaceBrowserBody` does not use text reads for DOCX or PPTX.
- Known over-limit local files expose the existing safe fallback actions.
- `AcpTurnFileActivity` and `AcpAttachmentPart` expose DOCX/PPTX through their
  active Preview paths while existing rich-format behavior is unchanged.

### Electron E2E

Add small deterministic DOCX and PPTX fixtures. The E2E test opens each fixture
from the right-side workspace browser and verifies:

- DOCX rendered text and page structure are visible.
- PPTX reports the correct slide count.
- The first PPTX Canvas has non-transparent rendered pixels.
- Next changes the displayed index and Canvas pixel digest.
- Previous returns to the first slide and restores disabled button states.
- Switching Workspace/Preview tabs never leaves two PPTX viewer instances
  mounted and restores the stored slide index after reparse.

The test runs with both the default artifact-panel width and its minimum
supported resized width so viewers remain usable when the panel is constrained.

## Harness and Documentation

Before implementation, add
`harness/specs/tasks/office-document-preview.md` with task type
`runtime-bridge`, scenario `chat-workspace-and-navigation`, and touched areas for
the capability helpers, viewer components, Artifact panel, Workspace Browser,
ACP file activity and attachment entry points, four locales, fixtures, tests,
and documentation. It references `renderer-main-boundary`,
`attachment-access-safety`, `tool-derived-file-safety`,
`ui-i18n-design-tokens`, `docs-sync`, and the new Office preview rule.

Update the existing workspace/navigation harness scenario with DOCX and PPTX
preview acceptance. Add `harness/specs/rules/office-preview-safety.md` to record:

- The exact supported and legacy format boundary.
- The 20 MB input limit.
- Scoped-read requirements.
- Lazy-loading and cleanup requirements.
- DOCX active-content and navigation restrictions.

Update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` wherever supported
preview formats are described. Document the Word pagination and PowerPoint
animation limitations.

This change does not alter Gateway events, delivery, runtime communication, or
fallback transport, so communication replay and comparison checks are not part
of its validation flow.

The implementation validation flow includes:

```sh
pnpm harness validate --spec harness/specs/tasks/office-document-preview.md
pnpm harness run --spec harness/specs/tasks/office-document-preview.md
pnpm run harness:ci
```

## Acceptance Criteria

- An in-limit valid `.docx` opens as centered, scrollable pages in every agreed
  preview entry point.
- An in-limit valid `.pptx` opens on slide one with working previous/next controls
  and an accurate slide count.
- A presentation containing supported charts renders with Chart.js available.
- Neither viewer triggers a text read, direct renderer filesystem access,
  network upload, or unscoped attachment fallback.
- Files over 20 MB do not reach either parser.
- Corrupt or encrypted files fail without replacing the current target, leaking
  technical details, or leaving ClawX-owned viewer resources behind.
- `.doc` and `.ppt` remain unsupported inline.
- Existing PDF, spreadsheet, image, HTML, Markdown, source, and diff preview
  behavior remains unchanged.
- Unit, Electron E2E, typecheck, lint, Vite build, and relevant harness checks
  pass.

## Known Risks

- Both parsers run in the Renderer and may briefly occupy the UI thread for
  complex files even below 20 MB.
- ZIP expansion can substantially exceed compressed input size; the 20 MB cap
  mitigates but does not fully prevent high peak memory use.
- `docx-preview` does not implement Word's complete layout engine, so wrapping
  and pagination can differ from Microsoft Word.
- `pptxviewjs` does not provide complete PowerPoint fidelity, especially for
  unsupported animations, transitions, media, fonts, and uncommon shapes.
- `pptxviewjs@1.1.9` retains some internal URLs, delayed work, and global
  references after public `destroy()`; repeated PPTX switches may retain memory
  until the Renderer exits. This is an explicitly accepted first-release risk.
- Embedded fonts may render differently when the document font cannot be loaded
  or the platform lacks a compatible fallback.

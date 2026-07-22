# Office Document Preview

Status: implemented contract, reviewed 2026-07-23.

Related scenarios: `chat-workspace-and-navigation`, `acp-chat-experience`, `acp-file-activity`

Related rule: `office-preview-safety`

Related task: `office-document-preview`

## Format And Limit Contract

Inline Office preview is extension-authoritative. Only the OOXML extensions below enter an Office parser:

| Extension | MIME mapping | Preview kind | Parser | Compressed input limit |
| --- | --- | --- | --- | --- |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `docx` | `docx-preview` | 20 MB (`20 * 1024 * 1024` bytes) |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `pptx` | `pptxviewjs@1.1.9` | 20 MB (`20 * 1024 * 1024` bytes) |

The extension wins when MIME conflicts. MIME alone never opts an unknown, missing, `.doc`, or `.ppt` extension into an OOXML parser. Legacy `.doc` and `.ppt` remain system-open-only. Office previews are read-only and do not expose Source or Diff tabs.

The shared discriminated limit contract is exact:

| Preview target | Maximum accepted input |
| --- | --- |
| Text | 2 MB (`2 * 1024 * 1024` bytes) |
| DOCX or PPTX rich preview | 20 MB (`20 * 1024 * 1024` bytes) |
| Image, PDF, or sheet rich preview | 50 MB (`50 * 1024 * 1024` bytes) |

The maximum itself is accepted and one byte above it is rejected. The Office limit applies to compressed input before parsing. Known over-limit files do not mount a viewer or import a parser. Unknown-size files use the same value as the Host API read `maxBytes`, so a race-time size increase returns `tooLarge` without transferring parser input.

## Dependencies And Loading

- `docx-preview` converts DOCX bytes to the generated HTML and CSS used for page preview. Its incomplete Word layout model is an accepted fidelity limitation.
- Exactly `pptxviewjs@1.1.9` parses PPTX packages and paints one slide at a time to Canvas. The version is pinned because the reviewed global-state, scheduler, cleanup, and accepted-retention decisions are specific to 1.1.9.
- `jszip` satisfies the PPTX parser's peer dependency and is the ZIP implementation used by the selected Office parsing dependencies.
- `chart.js` supplies `chart.js/auto`, which the selected `pptxviewjs` ESM build imports to paint supported embedded charts.

`FilePreviewBody` and `WorkspaceBrowserBody` load both Office viewer components with React `lazy()`. Each viewer dynamically imports its parser only after an authorized, in-limit binary read succeeds. This keeps the viewers, `jszip`, `chart.js`, and parser code out of the synchronous chat entry path and ensures rejected input cannot trigger parser initialization.

## Read Authority

Each viewer selects exactly one existing binary route and passes the 20 MB maximum:

| Target authority | Read route |
| --- | --- |
| Ordinary local path, including Workspace Browser's already validated absolute path | `readBinaryFile(filePath, { maxBytes })` |
| Explicit `WorkspaceFileRef` | `readWorkspaceBinary({ ...workspaceFileRef, maxBytes })` |
| Explicit `AttachmentFileRef` | `readAttachmentBinary(attachmentFileRef, maxBytes)` |

A target containing both scoped reference types is invalid and fails before any read. A scoped target never retries through `filePath`, another scope, or a naked-path API. Workspace Browser deliberately retains its existing Host-validated absolute-path route; other workspace-derived file activity enters Preview with its `WorkspaceFileRef`. Remote attachments do not enter preview and no preview-specific download flow exists.

Document bytes remain inside the existing Renderer/Main Host API boundary. The Renderer passes `Uint8Array` to parser APIs and does not use direct filesystem access, document `fetch()`, parser URL loaders, temporary files, uploads, Gateway endpoints, or a Main-process or external conversion service.

## Over-Limit Authority Routing

Over-limit behavior follows the target's authority rather than the display surface:

| Target | Behavior |
| --- | --- |
| Ordinary local Preview target | Show the too-large/direct-open surface with confirmed system open and reveal actions. |
| Workspace Browser validated absolute path | Show the same confirmed direct-open and reveal actions. |
| Local authorized attachment known to be over limit | `attachmentOpenMode()` chooses the existing scoped `hostApi.files.openAttachment()` system-open flow. |
| Remote attachment | Keep the existing scoped system-open flow; do not preview or download for preview. |
| `WorkspaceFileRef` Preview target | Show `tooLarge` without naked-path shell actions. |
| Scoped attachment whose bounded read detects a race-time size increase | Show `tooLarge` without falling back to a naked path. |

This distinction is required: ordinary paths own local shell authority, while scoped references retain only their scoped Host API authority.

## DOCX Rendering

`DocxViewer` creates a new detached body container and style container for each target generation. It invokes `renderAsync()` while both are disconnected, then appends the current generation's completed containers to an open Shadow Root on the React-owned host. Generated document CSS and DOM therefore cannot rewrite ClawX layout, and stale reads or renders cannot replace the selected document.

The render options are exact:

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

`renderAltChunks: false` prevents embedded HTML parts from entering the preview. Comments and tracked changes are disabled. `useBase64URL: true` avoids library-created Blob URL lifetime and keeps generated resources releasable with the Shadow Root containers.

Capturing `click` and `auxclick` listeners on the Shadow Root prevent the default action of every generated anchor. Hash, HTTP(S), file, and custom-protocol links are all non-interactive; DOCX preview cannot navigate the ClawX window or invoke shell authority.

Pages remain centered, vertical, authored-size paper sheets. A `ResizeObserver` resets body CSS `zoom` to `1`, measures the widest `section.clawx-docx`, and applies `Math.min(1, host.clientWidth / widestPageWidth)`. Chromium CSS zoom scales dimensions and flow together. The viewer scales down to fit but never enlarges above authored size.

On target replacement or unmount, ClawX disconnects the observer, removes generated style/body containers, clears their children, and drops its direct byte and DOM references. An uncancellable render may finish after cleanup, but generation checks prevent it from attaching stale content.

## PPTX Rendering And Scheduling

`PptxViewer` uses one React-owned Canvas keyed by target identity. Unlike DOCX resources, the initial PPTX Canvas is mounted when `pptxviewjs` renders into it; it is not first rendered detached. Target identity, committed-generation checks, and latest-request checks prevent stale work from publishing, while React key replacement or unmount detaches the obsolete Canvas.

The `PPTXViewer` constructor receives exactly these behaviorally significant options:

```ts
{
  canvas,
  enableThumbnails: false,
  slideSizeMode: 'fit',
  backgroundColor: '#ffffff',
  autoChartRerenderDelayMs: 0,
}
```

Before initial rendering, the viewer waits for positive container width and height for at most 60 checks, using at most 59 animation-frame waits. It applies the current container width and height as Canvas CSS dimensions before every render. `slideSizeMode: 'fit'` preserves the source aspect ratio within the centered preview surface.

A module-level promise queue serializes all `pptxviewjs` operations across lifecycles: construction, `loadFile()`, slide-count access, initial render, restored-position render, navigation, chart refresh, resize render, and `destroy()`. Each render request carries its generation, request identity, latest slide, and latest measured size; work made obsolete before execution is skipped. A failed current render terminates that lifecycle, while a rejected obsolete render cannot replace or fail the new target.

The presentation is parsed once per mounted target. Initial rendering always paints slide index zero. If the owning surface has a stored index for the same target identity, the viewer clamps it to the loaded slide range and then renders it. Position display is one-based, navigation is disabled at boundaries and while rendering, and `onSlideIndexChange` fires only after a successful current render.

The `ResizeObserver` uses a 100 ms trailing debounce. The callback does not render directly; after the debounce it re-reads dimensions and queues a current-slide refresh. Setting `autoChartRerenderDelayMs: 0` disables the dependency's uncancellable delayed chart render. The global `chartRenderingComplete` listener coalesces events while a refresh is pending and submits refreshes through the same serialized scheduler. Cleanup removes the listener and observer and cancels owned timers and animation frames.

## Single PPTX Instance

`pptxviewjs@1.1.9` stores presentation chart and ZIP state in Renderer globals including `window.currentProcessor` and `window.currentZipData`. At most one `PptxViewer` may therefore be mounted in the shared Electron Renderer. This is a correctness requirement, not a performance preference: concurrent decks could resolve chart or package data from the wrong presentation.

Workspace and Preview surfaces remain mounted to preserve surrounding UI state, but each conditionally mounts its PPTX child only while its artifact tab is active. CSS-only hiding is insufficient. A development assertion rejects a second concurrent viewer. The owning Workspace and Preview surfaces retain slide positions in maps keyed by target identity; switching away destroys and unmounts the viewer, and switching back reparses the deck and restores the clamped position.

Cleanup queues the active instance's public `destroy()` exactly once after preceding dependency work. ClawX removes all listeners, observers, timers, animation frames, queued request references, and its direct instance and Canvas ownership. The dependency limitations below mean this does not claim full internal reclamation.

## States And Errors

Both viewers expose four lifecycle states:

- `loading`: authorized read, lazy parser import, parse, or initial render is in progress.
- `ready`: DOCX pages or the current PPTX slide and controls are visible.
- `tooLarge`: preflight or the bounded Host API read rejects input above 20 MB.
- `error`: authority validation, read, empty input, parse, layout sizing, or render failed.

Errors use localized format-specific generic messages and never show parser exceptions, paths from parser errors, or stack traces. Corrupt, malformed, encrypted, password-protected, empty, and otherwise unsupported OOXML inputs may fail into `error`. There is no automatic retry loop. Reselecting or reopening a target creates a new load.

## Non-Goals

- Legacy `.doc` or `.ppt` parsing or conversion.
- Editing, saving, comments, tracked changes, Word search, or table-of-contents tooling.
- Pixel-identical Microsoft Word or PowerPoint layout.
- DOCX link opening or application-window navigation from generated content.
- PPTX thumbnails, keyboard shortcuts, animation, transitions, media playback, fullscreen, presenter mode, or automatic slide shows.
- Remote-attachment downloading for preview.
- Main-process, server, cloud, or external-service conversion.
- Changes to existing PDF, spreadsheet, image, HTML, Markdown, source, or diff behavior.

## Rejected Alternatives

- MIME-driven Office parser selection was rejected because legacy or unknown extensions must not enter an OOXML parser.
- Main-process or cloud conversion, temporary-file conversion, parser URL loading, and Renderer `fetch()` were rejected to preserve existing authority and data boundaries.
- DOCX light-DOM rendering and interactive generated links were rejected because document CSS and navigation must not gain application authority.
- Transform-only DOCX scaling was rejected because transformed pages can overlap later flow; Chromium CSS zoom scales layout dimensions with content.
- Keeping multiple PPTX viewers mounted under CSS `hidden` was rejected because shared dependency globals can cross-contaminate presentations.
- Independent initial, navigation, chart, and resize render paths were rejected because uncancelled operations can race. One serialized scheduler owns every dependency operation and render source.
- The library's delayed chart rerender was rejected in favor of an owned, coalesced event refresh. Patching `pptxviewjs` internals was also rejected; the reviewed public API and accepted limitation remain explicit.

## Accepted Risks And Limitations

- Both ZIP-based parsers run in the Renderer and can briefly occupy the UI thread on complex in-limit files.
- A 20 MB compressed cap reduces but does not eliminate ZIP expansion or high peak-memory risk.
- `docx-preview` is not Word's pagination engine; wrapping, page breaks, fonts, and layout can differ.
- `pptxviewjs` has incomplete PowerPoint fidelity for uncommon shapes, fonts, animations, transitions, and media.
- Embedded fonts depend on available platform fonts and fallbacks.
- Public `destroy()` in `pptxviewjs@1.1.9` does not fully clear internal caches, URLs, delayed work, or chart-related globals. Repeated presentation switches may retain dependency-owned memory until the Renderer exits. The single-instance rule prevents concurrent cross-presentation corruption but does not eliminate this accepted retention risk.

## Future Hardening

The current 20 MB check is a product performance guard, not a complete malicious-ZIP boundary. Future ZIP hardening may add pre-parse entry-count, expansion-ratio, and XML-complexity budgets. Such checks must preserve the same target authority routes and fail before either parser receives bytes; they are not implemented or implied by the current release.

## Validation Anchors

Format classification and limits are anchored by `shared/file-preview/limits.ts`, `src/lib/generated-files.ts`, `src/lib/file-preview-capabilities.ts`, `tests/unit/generated-files.test.ts`, and `tests/unit/open-file-utils.test.ts`.

Renderer authority, DOCX isolation/options/links/zoom, PPTX construction/sizing/scheduling/chart behavior/restoration/cleanup, stale-generation handling, and generic errors are anchored by `src/components/file-preview/DocxViewer.tsx`, `src/components/file-preview/PptxViewer.tsx`, and `tests/unit/office-file-viewers.test.tsx`.

Surface preflight, authority-specific fallback, conditional mounting, and position ownership are anchored by `src/components/file-preview/FilePreviewBody.tsx`, `src/components/file-preview/WorkspaceBrowserBody.tsx`, `src/components/file-preview/ArtifactPanel.tsx`, `src/pages/Chat/AcpTurnFileActivity.tsx`, `src/pages/Chat/AcpAttachmentPart.tsx`, `tests/unit/file-preview-body.test.tsx`, `tests/unit/workspace-browser-body.test.tsx`, `tests/unit/artifact-panel.test.tsx`, and `tests/unit/acp-chat-components.test.tsx`.

`tests/e2e/office-document-preview.spec.ts` uses real deterministic DOCX/PPTX packages to anchor Shadow Root page rendering, Canvas pixels, chart completion, slide navigation, per-target position restoration, constrained-panel resizing, the single-mounted-viewer invariant, Host API read routes, and absence of legacy direct IPC.

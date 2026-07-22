---
id: office-preview-safety
title: Office Preview Safety And Lifecycle
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - acp-chat-experience
  - acp-file-activity
requiredProfiles:
  - e2e
---

Inline Office parsing is extension-authoritative and supports only `.docx` and `.pptx`. Keep `.doc` and `.ppt` system-open-only, and never route a legacy, unknown, or missing extension into an OOXML parser from MIME alone. Use the discriminated preview-limit API: text input is capped at 2 MB, DOCX/PPTX compressed input at exactly `20 * 1024 * 1024` bytes, and image/PDF/sheet input at 50 MB. Accept the exact maximum and reject one byte above it. Known over-limit Office input must be rejected before viewer mount or parser import; unknown-size input must use the Office limit as the Host API read `maxBytes` and must not invoke a parser after `tooLarge`.

Select exactly one authorized binary-read path: ordinary paths use `readBinaryFile`, workspace references use `readWorkspaceBinary`, and attachment references use `readAttachmentBinary`. A target containing both scoped reference types is invalid and must fail before any read. Scoped reads never retry through `filePath`, another scope, or a naked-path API; Workspace Browser alone retains its existing Host-validated absolute-path read flow. Parse only `Uint8Array` bytes in the Renderer: do not add direct filesystem access, document `fetch()`, parser URL loading, temporary files, uploads, conversion services, or new IPC, Host API, or Gateway routes.

Over-limit behavior must preserve target authority. Ordinary local Preview and Workspace Browser paths may expose the existing confirmed system-open and reveal actions. A known over-limit or remote attachment stays on the existing scoped `openAttachment` system route. A `WorkspaceFileRef`, or an attachment whose bounded preview read detects a race-time size increase, shows `tooLarge` without naked-path shell actions or unscoped fallback.

Load `DocxViewer` and `PptxViewer` through React lazy imports, and defer each parser-library import until authorized bytes have arrived. Every read and parser operation must be guarded by the committed target identity and generation so stale work cannot publish into a replacement target. On target change, failure, or unmount, release all ClawX-owned direct byte, instance, DOM/Canvas, listener, observer, animation-frame, timer, and queued-request references.

DOCX renders each generation into detached body and style containers, attaching them only after the current render completes. Generated markup and styles stay inside a Shadow Root. Preserve the reviewed explicit render options, including `renderAltChunks: false`, `renderComments: false`, `renderChanges: false`, and `useBase64URL: true`. Capturing `click` and `auxclick` handling must prevent the default action of every rendered anchor regardless of URL scheme. Width fitting uses CSS zoom capped at `1`; do not expose editing or active document navigation.

PPTX renders into a React-owned Canvas keyed by target identity; it is not required to render initially into a detached Canvas. The mounted Canvas, viewer instance, load, and every render request remain target-specific and generation-guarded, and React replacement or unmount must detach the obsolete Canvas. Construct the dependency with thumbnails disabled, fit sizing, a white background, and its delayed chart rerender disabled. Wait a bounded 60 size checks for positive dimensions and synchronize Canvas CSS dimensions before every render.

Because `pptxviewjs@1.1.9` shares `window.currentProcessor` and `window.currentZipData`, the Electron Renderer may have only a single mounted `PptxViewer`. Kept-mounted surfaces must conditionally mount their PPTX child only while active; CSS hiding is insufficient. Initial, restored, navigation, chart-complete, 100 ms trailing-debounced resize, and teardown operations use the shared serialized scheduler, skip obsolete requests, and never render directly from an observer or chart event. Position is retained by target identity and reported only after successful current renders. Cleanup calls each created instance's public `destroy()` exactly once in scheduler order and removes every ClawX-owned resource.

Read, parse, sizing, and render failures must terminate in localized generic states without exposing parser exceptions or retry loops. The published dependency may retain internal URLs, delayed chart work, caches, and processor/ZIP globals after public `destroy()`. This dependency-owned retained-resource limitation and incomplete Office fidelity are accepted for the first release: do not patch or conceal them, and do not claim complete reclamation. The single-instance invariant prevents concurrent cross-presentation corruption but does not eliminate retained-resource or ZIP-expansion risk. Preserve the full durable rationale and validation anchors in `harness/reference/office-document-preview.md`.

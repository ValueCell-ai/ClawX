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

Inline Office parsing is extension-authoritative and supports only `.docx` and `.pptx`. Keep `.doc` and `.ppt` system-open-only, and never route a legacy, unknown, or missing extension into an OOXML parser from MIME alone. Use the discriminated preview-limit API: text input is capped at 2 MB, DOCX/PPTX compressed input at exactly `20 * 1024 * 1024` bytes, and image/PDF/sheet input at 50 MB. Reject over-limit Office input before parser import or invocation.

Select exactly one authorized binary-read path. A target containing both attachment and workspace scoped references is invalid and must fail before any read. Attachment and workspace scoped reads never retry through `filePath` or another unscoped API; Workspace Browser alone retains its existing Host-validated absolute-path read flow. Parse only `Uint8Array` bytes in the Renderer: do not add direct filesystem access, document `fetch()`, URL loading, temporary files, uploads, conversion services, or new IPC/Host API routes.

Load `DocxViewer` and `PptxViewer` through React lazy imports, and defer each parser-library import until the authorized bytes have arrived. Every load uses detached, target-specific render resources and may attach them only while its target identity remains current. On target change or unmount, detach those resources and release all ClawX-owned byte references, DOM/Canvas references, listeners, observers, animation frames, and timers.

DOCX generated markup and styles stay inside a Shadow Root. Disable altChunks, comments, and tracked changes, and prevent the default action of every rendered anchor regardless of URL scheme. Do not expose editing or active document navigation.

Because `pptxviewjs@1.1.9` shares `window.currentProcessor` and `window.currentZipData`, the Electron Renderer may have only a single mounted `PptxViewer`. Conditional mount sites must document this correctness constraint and reference the approved design. Initial, restored, navigation, chart-complete, and debounced resize rendering use one serialized scheduler. Cleanup calls the instance's public `destroy()` exactly once and removes every ClawX-owned resource.

The published dependency may retain internal URLs, delayed chart work, caches, and processor/ZIP globals after public `destroy()`. This dependency-owned retained-resource limitation is accepted for the first release: do not patch or conceal it, and do not claim complete reclamation. The single-instance invariant prevents concurrent cross-presentation corruption but does not eliminate that retained-resource risk.

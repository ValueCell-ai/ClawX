---
id: chat-workspace-and-navigation
title: Chat Workspace And Navigation
type: user-visible-flow
ownedPaths:
  - shared/workspace.ts
  - shared/chat/session-title.ts
  - electron/services/sessions-api.ts
  - electron/main/index.ts
  - src/lib/workspace-context.ts
  - src/hooks/use-workspace-availability.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/MarkdownPreview.tsx
  - src/components/file-preview/DocxViewer.tsx
  - src/components/file-preview/PptxViewer.tsx
  - src/components/file-preview/build-preview-target.ts
  - src/components/file-preview/open-file-utils.ts
  - src/lib/generated-files.ts
  - src/lib/file-preview-capabilities.ts
  - shared/file-preview/limits.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/components/web-browser/**
  - src/components/markdown/**
  - src/stores/artifact-panel.ts
  - src/components/layout/MainLayout.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/session-catalog.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-label-hydration.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/unit/generated-files.test.ts
  - tests/unit/open-file-utils.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/markdown-preview.test.tsx
  - tests/unit/streamdown-config.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/office-file-viewers.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/chat-new-session-date.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/markdown-file-preview.spec.ts
  - tests/e2e/hardware-acceleration.spec.ts
  - tests/e2e/renderer-performance.spec.ts
requiredProfiles:
  - fast
conditionalProfiles:
  e2e:
    - workspace selection, binding, sidebar, browser, or question navigation changes
    - Markdown file-preview rendering or syntax highlighting changes
requiredRules:
  - session-workspace-authority
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - sidebar-session-attention-authority
  - office-preview-safety
  - web-browser-security-and-lifecycle
  - markdown-rendering-safety-and-performance
  - electron-rendering-performance
  - docs-sync
---

This scenario covers inheriting the selected conversation's effective workspace when creating a new Chat; selecting persisted recent, known-session, or newly browsed workspaces while the new Chat remains unbound; validating workspace availability before ACP load; deriving a newly visible local-session title atomically from its first prompt; replacing matching synthetic UUID-date fallback titles with transcript prompts; recovering from deleted global or inherited workspace paths; marking unavailable non-default sidebar groups; permanently deleting their sessions after confirmation; binding workspaces through OpenClaw ACP cwd; targeting another agent without losing that agent's workspace or first prompt; restoring historical workspace context; renaming imported workspace display labels; navigating workspace-grouped sessions with busy, unread, and relative-time status; browsing the effective workspace; previewing authorized local HTML and supported Office documents under their documented safety boundaries; and jumping among user questions from an overlay that leaves the conversation width unchanged.

Workspace file browsing keeps the store value `browser`; local HTML uses the existing `preview` tab and has no independent browser tab or toolbar. Current workspace resolution, ordering, title normalization, and file-browser behavior are documented in `harness/reference/chat-workspace-and-navigation.md`; the HTML guest contract is documented in `harness/reference/web-browser.md`; static Markdown rendering and safety requirements are documented in `harness/reference/markdown-rendering.md`; desktop compositing and interaction profiling requirements are documented in `harness/reference/electron-rendering-performance.md`.

DOCX and PPTX files are accepted as read-only inline previews only at or below the 20 MB compressed-input boundary. Scoped workspace and attachment references retain their authorized read route without naked-path fallback, while Workspace Browser retains its Host-validated absolute-path flow. PPTX visibility must preserve the single mounted PPTX viewer invariant across the kept-mounted Workspace and Preview surfaces. Workspace ownership remains in `harness/reference/chat-workspace-and-navigation.md`; the complete Office contract is `harness/reference/office-document-preview.md`.

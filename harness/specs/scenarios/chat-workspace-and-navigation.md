---
id: chat-workspace-and-navigation
title: Chat Workspace And Navigation
type: user-visible-flow
ownedPaths:
  - shared/workspace.ts
  - shared/chat/session-title.ts
  - electron/services/sessions-api.ts
  - src/lib/workspace-context.ts
  - src/hooks/use-workspace-availability.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/stores/chat/session-actions.ts
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/file-preview/FilePreviewBody.tsx
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
  - src/stores/artifact-panel.ts
  - src/components/layout/MainLayout.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/unit/generated-files.test.ts
  - tests/unit/generated-files-panel.test.tsx
  - tests/unit/open-file-utils.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/office-file-viewers.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - tests/e2e/web-browser-navigation.spec.ts
  - tests/e2e/web-browser-lifecycle.spec.ts
  - tests/e2e/web-browser-policy.spec.ts
  - tests/e2e/office-document-preview.spec.ts
requiredProfiles:
  - fast
conditionalProfiles:
  e2e:
    - workspace selection, binding, sidebar, browser, or question navigation changes
requiredRules:
  - session-workspace-authority
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - sidebar-session-attention-authority
  - office-preview-safety
  - docs-sync
---

This scenario covers selecting a workspace for a new Chat, validating its availability before ACP load, recovering from deleted global workspace paths, marking unavailable non-default sidebar groups, permanently deleting their sessions after confirmation, binding workspaces through OpenClaw ACP cwd, targeting another agent without losing that agent's workspace or first prompt, restoring historical workspace context, renaming imported workspace display labels, navigating workspace-grouped sessions, browsing the effective workspace, using the distinct persistent Web Browser artifact tab, and jumping among user questions.

Workspace file browsing keeps the store value `browser`; the Electron Web Browser uses `web-browser`. Current workspace resolution, ordering, title normalization, and file-browser behavior are documented in `harness/reference/chat-workspace-and-navigation.md`; the Electron guest contract is documented in `harness/reference/web-browser.md`.

DOCX and PPTX files are accepted as read-only inline previews only at or below the 20 MB compressed-input boundary. Scoped workspace and attachment references retain their authorized read route without naked-path fallback, while Workspace Browser retains its Host-validated absolute-path flow. PPTX visibility must preserve the single mounted PPTX viewer invariant across the kept-mounted Workspace and Preview surfaces. The durable Office preview boundaries and limitations are documented in `harness/reference/chat-workspace-and-navigation.md`.

---
id: acp-file-activity
title: ACP OpenClaw File Activity
type: user-visible-flow
ownedPaths:
  - electron/services/files-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/lib/acp/openclaw-file-activities.ts
  - src/components/file-preview/**
  - src/components/web-browser/WebBrowserHost.tsx
  - src/stores/artifact-panel.ts
  - src/pages/Chat/AcpFileCard.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - tests/unit/openclaw-file-activities.test.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/e2e/chat-file-changes.spec.ts
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - session-workspace-authority
  - tool-derived-file-safety
  - office-preview-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
---

This scenario covers per-turn file buttons and summaries, session-level Changes, replay, workspace-scoped Preview, and independently revalidated Open with actions for created or modified files from successful OpenClaw `write`, `edit`, and `apply_patch` calls. HTML Open with menus can also route the existing workspace path into the right-side Web Browser as a local file URL. In-limit DOCX/PPTX activity uses `WorkspaceFileRef` Preview under the Office safety contract. Deleted activity never exposes Preview or Open with.

The UI represents tool-declared activity, not a verified filesystem or Git diff. Detailed input grammar, aggregation, and path safety are documented in `harness/reference/openclaw-file-activity.md`; Office parsing and lifecycle constraints are in `harness/reference/office-document-preview.md`.

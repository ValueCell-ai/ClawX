---
id: restore-acp-file-activity
title: Restore OpenClaw file activity in ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore per-turn and session-level OpenClaw file activity in ACP Chat while keeping tool-derived file access inside the bound workspace.
touchedAreas:
  - harness/reference/openclaw-file-activity.md
  - harness/specs/scenarios/acp-file-activity.md
  - harness/specs/rules/tool-derived-file-safety.md
  - harness/specs/tasks/restore-acp-file-activity.md
  - harness/src/runner.mjs
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
  - src/components/file-preview/MaterialFileIcon.tsx
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
  - tests/unit/harness-runner.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/artifact-panel-store.test.ts
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/chat-artifact-panel-layout.test.tsx
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/fixtures/electron.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Successful OpenClaw write, edit, and apply_patch calls render per-turn file buttons and change summaries.
  - The Changes tab shows a session-level record grouped by file, with at most one diff editor per turn and file.
  - File headers in Changes use the same extension-aware icons as the Workspace file tree.
  - A New Session with no qualifying activity says that this session has no file changes yet.
  - Created and modified tool-derived targets provide read-only in-app Preview plus workspace-scoped Open with and reveal actions; deleted targets expose neither native action.
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
  - acp-chat-state-and-history
  - session-workspace-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
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
  - Tool-derived Preview uses workspace-scoped read/stat host APIs without unscoped fallback; later workspace-scoped native actions independently revalidate `WorkspaceFileRef` and never accept a naked canonical path from Renderer.
  - The feature does not scan the workspace, use Git, create source snapshots, or infer shell side effects.
  - Full ACP replay restores available file activity and incomplete replay does not invent it.
  - Changes file headers use the shared Material file icon instead of a generic change icon.
  - Same-turn fragments for one file compose into one display diff when safe and concatenate into one display diff otherwise.
docs:
  required: true
---

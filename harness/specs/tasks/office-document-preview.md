---
id: office-document-preview
title: Add read-only Office document previews
scenario: chat-workspace-and-navigation
taskType: runtime-bridge
intent: Add Renderer-only DOCX and PPTX previews to existing authorized file surfaces without weakening scoped access or loading Office parsers in the initial chat bundle.
touchedAreas:
  - harness/reference/office-document-preview.md
  - harness/specs/tasks/office-document-preview.md
  - harness/specs/rules/office-preview-safety.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/reference/chat-workspace-and-navigation.md
  - package.json
  - pnpm-lock.yaml
  - shared/file-preview/limits.ts
  - src/lib/generated-files.ts
  - src/lib/file-preview-capabilities.ts
  - src/components/file-preview/open-file-utils.ts
  - src/components/file-preview/DocxViewer.tsx
  - src/components/file-preview/PptxViewer.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/build-preview-target.ts
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/harness-specs.test.ts
  - tests/unit/generated-files.test.ts
  - tests/unit/generated-files-panel.test.tsx
  - tests/unit/open-file-utils.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/rich-file-viewers.test.tsx
  - tests/unit/office-file-viewers.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/i18n-locale-parity.test.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/fixtures/office/sample.docx
  - tests/e2e/fixtures/office/slides-a.pptx
  - tests/e2e/fixtures/office/slides-b.pptx
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Authorized DOCX files at or below 20 MB render as isolated, read-only pages with non-interactive links in existing preview surfaces.
  - Authorized PPTX files at or below 20 MB render one slide at a time with localized previous and next controls, while at most one viewer is mounted in the Renderer.
  - Legacy DOC and PPT files, remote attachments, and over-limit Office files retain their existing safe system-open, unsupported, or too-large behavior according to target authority.
  - Existing image, PDF, spreadsheet, HTML, Markdown, source, diff, attachment, and workspace behavior remains unchanged.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - renderer-main-boundary
  - attachment-access-safety
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - office-preview-safety
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/generated-files.test.ts tests/unit/generated-files-panel.test.tsx tests/unit/open-file-utils.test.ts tests/unit/file-preview-body.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/office-file-viewers.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/i18n-locale-parity.test.ts tests/unit/harness-specs.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/office-document-preview.spec.ts tests/e2e/chat-acp-attachments.spec.ts tests/e2e/chat-file-changes.spec.ts
  - pnpm harness validate --spec harness/specs/tasks/office-document-preview.md
  - pnpm harness run --spec harness/specs/tasks/office-document-preview.md
  - pnpm run harness:ci
acceptance:
  - Extension-authoritative inline preview supports exactly DOCX and PPTX among Office document formats; DOC and PPT remain system-open-only, and MIME alone never selects an OOXML parser.
  - DOCX and PPTX compressed input accepts exactly 20 MB and rejects 20 MB plus one byte before parser loading; text remains limited to 2 MB and image, PDF, and sheet previews remain limited to 50 MB.
  - Each target uses exactly one authorized binary-read route, rejects simultaneous attachment and workspace references before reading, and never retries a scoped reference through filePath; Workspace Browser retains its Host-validated absolute-path route.
  - Office bytes are parsed only in the Renderer from Uint8Array input, viewer components are React-lazy loaded, and parser imports occur only after bytes arrive.
  - DOCX renders with altChunks, comments, and tracked changes disabled in isolated generated DOM, and every rendered anchor default action is disabled.
  - At most a single mounted PPTX viewer exists in the Renderer; all renders are serialized, target resources are detached on cleanup, and public destroy is called exactly once per active instance.
  - All Office preview strings and controls have matching English, Chinese, Japanese, and Russian chat locale coverage and use project design tokens.
  - Focused unit, typecheck, lint, Vite build, Office Electron E2E, harness validate and run, harness CI, and synchronized README checks pass without a comms profile.
docs:
  required: true
---

## Scope

This contract governs the complete Office preview implementation recorded in `harness/reference/office-document-preview.md` and enforced by `harness/specs/rules/office-preview-safety.md`. It extends the existing workspace/navigation scenario without adding a new communication transport or Main-process document conversion path.

## Durable Contracts

Implementation tasks must preserve `harness/specs/rules/office-preview-safety.md` together with the existing Renderer/Main, attachment, tool-derived file, localization, and documentation rules. Durable Office behavior and implementation rationale are recorded in `harness/reference/office-document-preview.md`; workspace and preview ownership remains recorded in `harness/reference/chat-workspace-and-navigation.md`.

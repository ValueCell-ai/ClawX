---
id: share-skill-and-workspace-reader
title: Share the skill and workspace file reader
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Present skill files in a right drawer that directly wraps the shared workspace file reader, with independent conversation selection.
touchedAreas:
  - src/components/file-preview/**
  - src/components/web-browser/**
  - src/components/layout/**
  - src/pages/Skills/index.tsx
  - src/pages/Agents/index.tsx
  - src/stores/artifact-panel.ts
  - src/stores/html-preview.ts
  - shared/i18n/locales/*/skills.json
  - shared/i18n/locales/*/common.json
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Opening a skill file shows the shared read-only reader in a right drawer; closing restores focus to its file entry and preserves detail scroll position.
  - Workspace and skill files share the file header, source/preview tabs, read-only renderers and scoped file actions.
  - Markdown previews expose parser-recognized YAML/TOML frontmatter in a default-expanded, collapsible localized Metadata disclosure that preserves literal content and indentation.
  - Conversation file selection and remembered slide positions are independent of skill reading state.
  - HTML preview is owned by its mounted reader, not conversation state; inactive readers cannot display a guest over another view.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - shared-file-reader
  - renderer-main-boundary
  - backend-communication-boundary
  - office-preview-safety
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/e2e/skills-gateway-readiness.spec.ts
  - tests/e2e/workspace-panel.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/unit/web-browser-host.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/markdown-preview.test.tsx
  - tests/e2e/markdown-file-preview.spec.ts
  - tests/unit/artifact-panel.test.tsx
acceptance:
  - Skill reading uses a thin Sheet container around FilePreviewSurface, without another centered modal, duplicate viewers or changes to the conversation's focused file.
  - Escape closes the file drawer before dismissing details; closing details returns focus to the skill card.
  - Scoped reads and reveal actions retain their authority, skill files remain read-only, and only one PPTX parser mounts at a time.
  - Existing Main URL validation, navigation restrictions and Host API routes remain unchanged.
docs:
  required: true
---

See `harness/reference/office-document-preview.md` and `harness/reference/web-browser.md`.

---
id: unify-acp-file-cards
title: Unify ACP attachment and file-activity cards
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Share one ACP file-card and Open with interaction while adding independently validated workspace-scoped native actions for created and modified file activity.
touchedAreas:
  - harness/specs/tasks/unify-acp-file-cards.md
  - harness/specs/scenarios/acp-file-activity.md
  - harness/specs/rules/tool-derived-file-safety.md
  - harness/specs/tasks/restore-acp-file-activity.md
  - harness/reference/openclaw-file-activity.md
  - shared/host-api/contract.ts
  - electron/services/files-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/Chat/AcpFileCard.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - src/components/web-browser/WebBrowserHost.tsx
  - src/stores/artifact-panel.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/files-api-workspace.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/artifact-panel-store.test.ts
  - tests/unit/web-browser-host.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Created and modified file-activity rows keep Preview and Changes controls and add the same Open with menu used by eligible assistant attachments.
  - HTML file activity and eligible local HTML attachments put Open in built-in browser first; selecting it opens and activates the Web Browser tab at the file URL.
  - Deleted file-activity rows continue to open Changes and never show Open with.
  - macOS and Windows list compatible applications; Linux and discovery failure retain reveal-only behavior.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - session-workspace-authority
  - tool-derived-file-safety
  - attachment-access-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/files-api-workspace.test.ts tests/unit/host-api-facade.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/artifact-panel-store.test.ts tests/unit/web-browser-host.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts tests/e2e/chat-acp-attachments.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/unify-acp-file-cards.md
  - pnpm harness run --spec harness/specs/tasks/unify-acp-file-cards.md
  - pnpm run harness:ci
acceptance:
  - Attachment and file-activity variants use one file-card shell and one target-aware Open with menu while retaining their distinct references and authorization models.
  - Only created and modified file activity exposes Open with; deleted activity retains only Changes behavior.
  - HTML Open with menus place the built-in browser action first and separate it from native applications; the action opens and activates the right-side Web Browser even before its guest has attached.
  - Renderer supplies only a workspace root, relative path, and opaque selected handler id for workspace operations and never receives a canonical path or native command.
  - Main independently canonicalizes and contains the target, rejects non-files and symlink escapes, and freshly revalidates before handler discovery, selected-handler invocation, and reveal.
  - Linux performs no application discovery and offers only reveal through the same workspace-scoped action.
  - Four-locale UI, unit, Electron E2E, typecheck, lint, build, communication regression, and harness validation pass.
docs:
  required: true
---

## Scope

This task covers the shared Renderer card/menu abstraction, workspace-scoped Host API operations, file-activity eligibility, localized behavior, safety contract updates, documentation, and regression coverage.

## Out Of Scope

- Converting tool-derived file activity into attachment evidence.
- Showing Open with for deleted, failed, unsupported, or unsafe file activity.
- Adding Linux application discovery or changing attachment preview classification.

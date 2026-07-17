---
id: chat-workspace-and-navigation
title: Chat Workspace And Navigation
type: user-visible-flow
ownedPaths:
  - shared/workspace.ts
  - shared/chat/session-title.ts
  - electron/services/sessions-api.ts
  - src/lib/workspace-context.ts
  - src/stores/settings.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
requiredProfiles:
  - fast
conditionalProfiles:
  e2e:
    - workspace selection, binding, sidebar, browser, or question navigation changes
requiredRules:
  - session-workspace-authority
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - docs-sync
---

This scenario covers selecting a workspace for a new Chat, binding it through OpenClaw ACP cwd, restoring historical workspace context, renaming imported workspace display labels, navigating workspace-grouped sessions, browsing the effective workspace, and jumping among user questions.

The current resolution, ordering, title normalization, and browser behavior are documented in `harness/reference/chat-workspace-and-navigation.md`.

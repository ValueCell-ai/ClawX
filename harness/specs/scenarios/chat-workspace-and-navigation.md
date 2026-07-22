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
  - src/components/layout/Sidebar.tsx
  - src/components/layout/session-buckets.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
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

This scenario covers selecting persisted recent, known session, or newly browsed workspaces for a new Chat, validating workspace availability before ACP load, recovering from deleted global workspace paths, marking unavailable non-default sidebar groups, permanently deleting their sessions after confirmation, binding workspaces through OpenClaw ACP cwd, targeting another agent without losing that agent's workspace or first prompt, restoring historical workspace context, replacing synthetic UUID-date session titles with transcript prompts, renaming imported workspace display labels, navigating workspace-grouped sessions, browsing the effective workspace, and jumping among user questions.

The current resolution, ordering, title normalization, and browser behavior are documented in `harness/reference/chat-workspace-and-navigation.md`.

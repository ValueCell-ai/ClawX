---
id: delete-unavailable-chat-workspace
title: Delete unavailable chat workspace groups
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Mark unavailable non-default workspace groups in the Chat sidebar and let users permanently delete every session in such a group without risking concurrent session-index writes.
touchedAreas:
  - harness/specs/tasks/delete-unavailable-chat-workspace.md
  - harness/specs/tasks/prompt-for-missing-chat-workspace.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/session-workspace-authority.md
  - harness/reference/chat-workspace-and-navigation.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/chat/types.ts
  - src/components/layout/Sidebar.tsx
  - src/hooks/use-workspace-availability.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/settings.ts
  - tests/unit/use-workspace-availability.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/settings-store.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
expectedUserBehavior:
  - Sidebar validates each distinct non-default workspace through the Main-owned files host API.
  - Only confirmed unavailable non-default workspace groups show an unavailable badge and destructive delete action.
  - One confirmation explains that every session in the workspace group will be permanently deleted.
  - Session deletion is sequential across all agents in the group so sessions.json updates cannot race.
  - Successful deletions disappear together; failed deletions remain visible and can be retried.
  - Deleting the selected group switches Chat once to a remaining session or the default new-session context.
  - Successful group deletion removes the path from recent workspaces and custom labels, and resets the global new-chat workspace when needed.
  - Default and available workspace groups never expose the group delete action.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - session-workspace-authority
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/delete-unavailable-chat-workspace.md
  - pnpm exec vitest run tests/unit/use-workspace-availability.test.tsx tests/unit/chat-store-history-retry.test.ts tests/unit/settings-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Workspace availability remains Main-authoritative and is not inferred from renderer state.
  - Group deletion is impossible until a non-default workspace has been confirmed unavailable.
  - Bulk deletion reuses the existing hard-delete host operation sequentially and reports partial failure.
  - Settings cleanup never changes workspace authority for surviving bound sessions.
  - User-facing copy is complete in English, Chinese, Japanese, and Russian.
docs:
  required: true
---

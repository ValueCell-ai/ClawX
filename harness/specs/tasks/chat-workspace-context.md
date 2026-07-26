---
id: chat-workspace-context
title: Bind chat sessions to OpenClaw cwd workspace context
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add chat workspace selection while keeping OpenClaw ACP session cwd as the single source of truth for bound sessions.
touchedAreas:
  - .gitignore
  - .prettierrc
  - package.json
  - pnpm-lock.yaml
  - tailwind.config.js
  - harness/specs/tasks/chat-workspace-context.md
  - harness/**
  - harness/reference/chat-workspace-and-navigation.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/session-workspace-authority.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron/**
  - shared/**
  - src/**
  - tests/**
  - shared/workspace.ts
  - shared/chat/session-title.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - electron/services/sessions-api.ts
  - src/lib/workspace-context.ts
  - src/lib/host-api.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/layout/session-buckets.ts
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/session-buckets.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
expectedUserBehavior:
  - New chat sessions use the globally selected workspace until their first send.
  - Editable new chats list persisted recent and known session workspaces in the composer menu, alongside the default workspace and native folder picker.
  - First send initializes the OpenClaw ACP session with the selected cwd.
  - Existing sessions use OpenClaw ACP cwd as their read-only workspace context.
  - Historical sessions with recoverable OpenClaw cwd group under their real cwd.
  - Sessions without recoverable cwd group under the default workspace label.
  - Imported workspace display names can be renamed without changing their authoritative paths.
  - Renamed workspace labels stay synchronized between the sidebar and chat composer, while hover text exposes the path.
  - OpenClaw ACP cwd injection remains enabled, while automatic conversation titles omit its leading working-directory envelope.
  - OpenClaw UUID-date fallback titles are replaced by the transcript's first user prompt and are never persisted by an unchanged rename.
  - Renderer continues to use host-api and never calls direct IPC or Gateway HTTP.
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
  - pnpm harness validate --spec harness/specs/tasks/chat-workspace-context.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/workspace-context.test.ts tests/unit/session-title.test.ts tests/unit/host-services.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/sidebar-session-buckets.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/session-buckets.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/workspace-browser-body.test.tsx
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - OpenClaw ACP cwd is the authoritative session workspace when available.
  - ClawX only persists global workspace selection and recent workspaces.
  - The editable composer workspace menu shows deduplicated recent and known-session non-default workspaces with their custom display labels.
  - Bound session footer workspace is read-only.
  - Right workspace tree root matches effective chat workspace.
  - Sidebar groups sessions by workspace, then sorts each flat group by the shared activity timestamp without date buckets.
  - Custom workspace labels persist through Main-owned settings and never replace path identity.
  - Explicit user session labels remain unchanged even when they begin with a working-directory-looking string.
  - A UUID-date fallback matching the OpenClaw session id is not treated as an explicit or derived user-facing title.
docs:
  required: true
---

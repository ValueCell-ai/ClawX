---
id: acp-native-chat
title: Move Chat to ACP-native Main-owned stdio transport and Renderer reducer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the ClawX-specific Chat stream/history path with ACP session/load, session/prompt, session/cancel, session/update, and session/request_permission while keeping non-Chat Gateway capabilities intact.
touchedAreas:
  - harness/specs/tasks/acp-native-chat.md
  - package.json
  - pnpm-lock.yaml
  - harness/reference/acp-chat.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - shared/acp-chat/**
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/utils/openclaw-cli.ts
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/lib/acp/**
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - shared/i18n/locales/**/chat.json
  - tests/unit/acp-*.test.ts
  - tests/unit/acp-*.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/task-visualization.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Opening a Chat session loads history through ACP session/load replay.
  - Sending a Chat prompt uses ACP session/prompt, shows an optimistic user segment, and coalesces it with the ACP user echo.
  - Thinking, tool calls, permission requests, plans, generated files, and generated images appear as inline timeline blocks in ACP event order.
  - The old Execution Graph aggregation is not used for the ACP Chat path.
  - Renderer does not call Gateway HTTP or WebSocket endpoints directly.
  - Gateway-backed models, providers, plugins, skills, doctor, workspace, settings, and media configuration continue to work.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - diagnostics-trace-safety
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts tests/unit/openclaw-cli.test.ts tests/unit/host-services.test.ts tests/unit/chat-page-execution-graph.test.tsx tests/unit/task-visualization.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts tests/e2e/chat-task-visualizer.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Main starts and reuses openclaw acp through a spawn-safe CLI spec and @agentclientprotocol/sdk ClientSideConnection.
  - Main forwards ACP SessionNotification envelopes and permission request envelopes without translating text, thinking, tools, or media into legacy Chat events.
  - Renderer reduces ACP notifications into an in-memory ordered timeline.
  - No ClawX ACP replay ledger, Chat history cache, or reduced timeline persistence is introduced.
  - The primary Chat page does not use gateway:chat-message or chat:runtime-event as ordinary Chat timeline sources; restricted image-generation compatibility evidence remains allowed.
  - Inline process blocks preserve ordering between assistant message segments.
docs:
  required: true
---

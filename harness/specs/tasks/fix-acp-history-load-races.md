---
id: fix-acp-history-load-races
title: Make ACP history loading atomic and race-safe
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent long ACP histories from visibly replaying and losing their prefix when users switch rapidly between sessions.
touchedAreas:
  - harness/specs/tasks/fix-acp-history-load-races.md
  - package.json
  - harness/reference/acp-chat.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - shared/acp-chat/types.ts
  - electron/services/acp-chat-service.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/AcpToolCallCard.tsx
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Opening a long historical conversation shows a loading state followed by the complete timeline, without exposing chunk-by-chunk replay.
  - Switching to a new conversation and quickly returning preserves the complete historical timeline.
  - Overlapping requests for the same session cannot mix replay generations or duplicate history.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - host-events-fallback-policy
  - acp-chat-state-and-history
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Main serializes ACP session load operations on the shared ACP connection.
  - Main returns notifications emitted during session load as one generation-scoped raw batch instead of forwarding them incrementally.
  - Renderer reduces a completed load batch and exposes the resulting timeline in one state commit.
  - Renderer merges generation-matching updates from the IPC result handoff window without exposing partial state.
  - Permission requests outside an active prompt are cancelled and cannot leave an invisible waiter during load handoff.
  - Renderer operation identity does not advance the Main-owned ACP generation or reject valid replay events after a local-only new conversation.
  - Stale load completions and stale session updates remain ignored.
  - No persistent ACP history cache, second replay ledger, or OpenClaw source change is introduced.
docs:
  required: true
---

## Scope

This task changes only the transaction boundary around ACP `session/load`. Live `session/prompt` notifications continue to use the existing host event path.

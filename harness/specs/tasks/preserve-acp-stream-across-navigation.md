---
id: preserve-acp-stream-across-navigation
title: Preserve ACP streams across chat navigation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep an in-flight ACP response live when users leave its conversation and return before the prompt completes.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/preserve-acp-stream-across-navigation.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - shared/acp-chat/types.ts
  - electron/services/acp-chat-service.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Leaving a conversation during an ACP response does not stop collection of that conversation's live updates.
  - Returning before the prompt completes restores the latest in-memory timeline and continues streaming new updates.
  - Returning after the prompt completes uses normal ACP history replay.
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
  - Main routes live notifications by their ACP session id instead of rewriting every event to the currently viewed session.
  - Main retains only the routing context needed by an in-flight prompt and can reactivate that prompt without invoking ACP session/load.
  - Renderer retains only in-flight, memory-only timeline snapshots and updates them while their conversation is not selected.
  - Renderer restores the in-flight snapshot atomically when Main confirms prompt reactivation.
  - Completed prompts release their in-flight routing and timeline state so ACP replay remains the history authority.
  - Stale generations, unrelated ACP session ids, and failed loads remain ignored.
  - No persistent timeline cache, second history ledger, or OpenClaw source change is introduced.
docs:
  required: true
---

## Scope

This task adds a bounded live-run handoff for ACP prompts. It does not change persisted history authority or reconstruct missing protocol events.

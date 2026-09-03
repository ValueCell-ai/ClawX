---
id: stream-loaded-subagent-session-live
title: Stream a loaded subagent session live
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep a running native subagent conversation live after the user drills into it instead of showing only its session/load snapshot.
touchedAreas:
  - harness/specs/tasks/stream-loaded-subagent-session-live.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/surface-subagent-sessions-and-announcements.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/acp-chat.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - src/pages/Chat/index.tsx
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/e2e/chat-subagent-sessions.spec.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpSessionPlan.tsx
  - src/pages/Chat/AcpSubagentSessions.tsx
  - src/pages/Chat/AcpToolCallCard.tsx
  - src/pages/Chat/ChatInput.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/acp-session-plan.test.tsx
  - tests/unit/acp-subagent-sessions.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/chat-input.test.tsx
expectedUserBehavior:
  - Drilling into a running native subagent first restores its ACP session/load snapshot and then appends assistant, thought, and tool lifecycle updates as they arrive.
  - Live child text and tool updates appear before the child run settles and use the same streaming presentation as an ordinary active ACP response.
  - A cumulative assistant snapshot received after replay or a tool boundary appends only its unseen suffix instead of repeating the replayed prefix.
  - Ordinary no-pending runs for loaded parent sessions and events for unrelated sessions remain ignored.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-events-fallback-policy
  - acp-chat-state-and-history
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/stream-loaded-subagent-session-live.md
  - pnpm exec vitest run tests/unit/openclaw-acp-stream-patch.test.ts
  - pnpm exec playwright test tests/e2e/chat-subagent-sessions.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The patched ACP adapter may project a no-pending ordinary Chat run only when its exact ambient session key has canonical `agent:<agentId>:subagent:<childId>` shape.
  - Existing no-pending `announce:v1` delivery remains available for any exact loaded session.
  - Mismatched sessions, malformed child keys, and ordinary no-pending parent runs remain ignored.
  - Accepted child events use the existing recorded ambient ACP assistant, thought, and tool lifecycle update paths plus the terminal checkpoint path; Renderer does not add Gateway polling, transcript reads, or a second history projection.
  - Child session/load replay remains atomic. The adapter subscribes before fetching the replay snapshot, buffers exact-session assistant, thought, and tool events during replay, and drains them in arrival order after establishing the replay baseline.
  - Ambient-session replacement is transactional: the previous owner and subscription remain available until load commits and are restored on any replay, snapshot, or command failure.
  - The adapter seeds its run-scoped cumulative text and thought baselines from replay, preserves those baselines across tool boundaries in the same assistant turn, and resets them only at a real user-message boundary.
  - Gateway catalog run state remains the authority for whether the selected child timeline is presented as streaming.
  - Explicit terminal catalog state overrides transient attention and session-switch fallbacks so settled child text stops animating and its read-only thinking indicator disappears.
docs:
  required: true
---

## Scope

This task extends the pinned ACP adapter's passive loaded-session bridge from announcement-only runs to ordinary runs for an exact canonical native subagent. The exception is necessary because `sessions_spawn` starts the child outside the current ACP connection, so that run has no local pending prompt even after the child is loaded. ACP remains the only Chat content path, and Gateway remains only the child run-state authority.

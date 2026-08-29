---
id: acp-session-plan-indicator
title: Project the current ACP session plan into the composer
scenario: acp-chat-experience
taskType: ui-feature
intent: Project the latest replayable update_plan into the active chat composer without additional persistence.
touchedAreas:
  - harness/specs/tasks/acp-session-plan-indicator.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/lib/acp/current-plan.ts
  - src/pages/Chat/AcpSessionPlan.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/acp-current-plan.test.ts
  - tests/unit/acp-session-plan.test.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - The active ACP session shows the latest valid update_plan above the composer as a read-only, initially collapsed progress pill.
  - Switching sessions, reloading, or restarting restores a plan only when ACP replay supplies that session's structured update_plan input.
  - When no valid structured plan is available, the composer shows no plan indicator.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - renderer-main-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-current-plan.test.ts
  - pnpm exec vitest run tests/unit/acp-session-plan.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "session plan|plan indicator"
  - pnpm harness validate --spec harness/specs/tasks/acp-session-plan-indicator.md
  - pnpm harness run --spec harness/specs/tasks/acp-session-plan-indicator.md --dry-run
acceptance:
  - The projection validates structured ToolCallItem.input data as a non-empty ordered plan whose entries have non-empty steps, recognized pending, in_progress, or completed statuses, and at most one in-progress entry.
  - The projection selects the newest valid update_plan tool call that is not failed and falls back to the preceding valid plan when a newer update fails.
  - Plan restoration is scoped to the active ACP session's replayed timeline and recomputes when that timeline changes.
  - The feature adds no persistence, cache, transport, backend endpoint, IPC channel, or plan mutation control.
  - The composer indicator is read-only, collapsed by default for each mounted session, keyboard accessible, and expands only to show the normalized plan details.
  - New plan UI strings have matching English, Chinese, Japanese, and Russian chat locale entries.
  - Electron E2E covers live plan display plus session-switch and reload replay restoration from rawInput.plan.
docs:
  required: false
---

## Scope

This task defines a Renderer-only ACP timeline projection. It does not change Main-owned ACP transport, history replay, or session routing. The durable ACP replay and authority boundary is documented in `harness/reference/acp-chat.md`.

## Out Of Scope

- Inferring plan steps from tool titles, tool output, or assistant prose.
- Retaining a plan when ACP replay no longer supplies valid structured input.
- Editing, completing, deleting, or otherwise mutating OpenClaw plan steps.

---
id: fix-chat-session-switch-flash
title: Avoid transient greetings and spinners during session selection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Distinguish pending session history from genuinely empty conversations without changing history authority.
touchedAreas:
  - src/pages/Chat/index.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - harness/specs/tasks/fix-chat-session-switch-flash.md
  - harness/specs/rules/acp-chat-state-and-history.md
expectedUserBehavior:
  - Switching persisted conversations never flashes the new-conversation greeting.
  - Fast loads do not flash a spinner; slow loads retain loading feedback.
  - New local conversations still show the greeting immediately.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - acp-chat-state-and-history
requiredTests:
  - pnpm exec vitest run tests/unit/chat-acp-page.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Workspace resolution and history loading share one pending presentation.
  - Deferred rendering never exposes another session or an obsolete empty timeline after load completion.
  - Electron coverage observes intermediate DOM states during sidebar switching.
docs:
  required: true
---

Presentation-only fix under the ACP chat experience. No transport, history caching,
or persisted session changes. Reviewed README.md, README.zh-CN.md, and
README.ja-JP.md; their documented workflows remain unchanged.

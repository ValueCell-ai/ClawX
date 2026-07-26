---
id: fix-target-agent-first-send
title: Keep targeted agent first sends atomic
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure the first prompt sent to a newly created agent uses that agent's workspace and is not cancelled by a competing ACP session load.
touchedAreas:
  - harness/specs/tasks/fix-target-agent-first-send.md
  - harness/reference/chat-workspace-and-navigation.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/session-workspace-authority.md
  - src/pages/Chat/index.tsx
  - shared/chat/types.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Selecting a newly created agent in the Chat composer and sending the first prompt creates and binds that agent's main ACP session.
  - The prompt uses the target agent workspace instead of the current or global workspace.
  - Session navigation cannot start a competing load that silently cancels the targeted prompt.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - host-events-fallback-policy
  - session-workspace-authority
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fix-target-agent-first-send.md
  - pnpm exec vitest run tests/unit/chat-acp-page.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Target-agent navigation records the explicit target workspace on the renderer session placeholder before reactive ACP loading can run.
  - The first targeted send requests ACP session creation when the target main session is not present.
  - The targeted send and the reactive loader share one session-and-workspace identity, preventing a second load from superseding the prompt path.
  - Existing target sessions continue to load without creating duplicates.
  - Renderer continues to use host-api and does not add direct IPC or Gateway HTTP calls.
docs:
  required: true
---

## Scope

This task fixes the renderer coordination between target-agent navigation, workspace resolution, ACP load identity, and first-prompt delivery. It does not change the Main-owned ACP transport or OpenClaw runtime.

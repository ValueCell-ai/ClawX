---
id: fix-acp-sidebar-title-race
title: Prevent ACP client identity from flashing as a new chat title
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep a locally prepared ACP session hidden until its first prompt and title become visible atomically.
touchedAreas:
  - harness/specs/tasks/fix-acp-sidebar-title-race.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/session-workspace-authority.md
  - harness/reference/chat-workspace-and-navigation.md
  - shared/chat/types.ts
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/chat/session-actions.ts
  - src/stores/chat/session-catalog.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/chat-session-actions.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/session-catalog.test.ts
  - tests/e2e/chat-new-session-date.spec.ts
expectedUserBehavior:
  - A new chat remains absent from the sidebar until its ACP session is created successfully.
  - A cold-start session created to replace hidden heartbeat history follows the same local-placeholder lifecycle.
  - Its first visible title is derived from the first user prompt, never the ACP bridge client display name.
  - Explicit and cached session labels remain authoritative.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - session-workspace-authority
  - sidebar-session-attention-authority
requiredTests:
  - pnpm exec vitest run tests/unit/session-catalog.test.ts tests/unit/chat-load-sessions-startup.test.ts tests/unit/chat-session-actions.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-acp-page.test.tsx
  - pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-new-session-date.spec.ts
  - pnpm run typecheck
acceptance:
  - Gateway event patches and canonical session-list refreshes preserve `createdLocally` until successful ACP creation acknowledgement.
  - Cold-start heartbeat replacement sessions are marked `createdLocally` and cannot bypass first-prompt title seeding.
  - Creation acknowledgement atomically restores a raced-away placeholder, seeds the first-prompt title, and exposes the row.
  - Renderer does not special-case the literal `ACP` title or add a competing backend title source.
  - Comms replay and compare pass.
docs:
  required: true
---

The OpenClaw ACP bridge legitimately reports `ACP` as its Gateway client display name. ClawX treats that value as transport provenance and keeps it behind the local new-chat placeholder until the user-authored title is ready.

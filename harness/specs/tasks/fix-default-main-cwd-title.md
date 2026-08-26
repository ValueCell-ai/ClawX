---
id: fix-default-main-cwd-title
title: Repair truncated cwd titles for the canonical main conversation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent OpenClaw's truncated ACP working-directory envelope from becoming the visible title of the canonical main conversation.
touchedAreas:
  - harness/specs/tasks/fix-default-main-cwd-title.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/rules/session-workspace-authority.md
  - harness/reference/chat-workspace-and-navigation.md
  - shared/chat/session-title.ts
  - src/stores/chat/session-label-hydration.ts
  - tests/unit/session-title.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
expectedUserBehavior:
  - A canonical `agent:main:main` conversation whose automatic title is only `[Working directory: …]…` is titled from its first real user prompt.
  - The synthetic cwd envelope is not shown while transcript-summary title hydration completes.
  - Explicit user labels that resemble a working-directory envelope remain unchanged.
  - Renderer continues to use the existing Main-owned session summary route.
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
  - pnpm harness validate --spec harness/specs/tasks/fix-default-main-cwd-title.md
  - pnpm exec vitest run tests/unit/session-title.test.ts tests/unit/chat-store-session-label-fetch.test.ts
  - pnpm run typecheck
  - pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Synthetic truncated cwd titles are excluded from automatic title display sources.
  - The canonical main session remains eligible for summary hydration when its automatic title is a truncated cwd envelope, even after its workspace has already been resolved.
  - The transcript's first user prompt replaces the synthetic automatic title.
  - Explicit user labels are not stripped or rejected as cwd metadata.
docs:
  required: false
---

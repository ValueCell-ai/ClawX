---
id: acp-slash-command-replies
title: Preserve ACP slash command replies
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let OpenClaw recognize slash commands sent through the ACP bridge so command replies are projected into the visible chat timeline.
touchedAreas:
  - harness/specs/tasks/acp-slash-command-replies.md
  - electron/services/acp-chat-service.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/e2e/chat-acp-slash-command-replies.spec.ts
expectedUserBehavior:
  - Sending /status in ClawX produces a visible assistant status reply.
  - Existing slash commands such as /compact continue to produce visible replies.
  - Ordinary prompts continue to receive the working-directory prefix used by OpenClaw ACP.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-events-fallback-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-slash-command-replies.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ACP prompts whose trimmed text starts with / disable OpenClaw's cwd text prefix.
  - Ordinary ACP prompts retain the cwd text prefix.
  - Slash command replies continue through the existing ACP session-update timeline path without transcript reconstruction or synthetic Renderer replies.
  - Renderer does not add direct IPC, Gateway HTTP, or Gateway WebSocket calls.
docs:
  required: false
---

OpenClaw classifies text slash commands before folding streamed command blocks into
the final chat message. A working-directory text prefix prevents that classification
and can leave commands such as `/status` without a visible ACP assistant reply.

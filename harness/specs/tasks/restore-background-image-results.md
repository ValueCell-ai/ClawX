---
id: restore-background-image-results
title: Show background image generation in live and reopened ACP chats
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore progress and the inline image when OpenClaw dispatches image generation as a namespaced background task.
touchedAreas:
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/tasks/restore-background-image-results.md
  - src/lib/acp/image-generation-compat.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-run-state-events.spec.ts
expectedUserBehavior:
  - A user sees the generation indicator after a tool dispatch and the decoded image when the background task finishes in the same chat.
  - Reopening the same conversation restores the image from recorded history without a second generation request.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - diagnostics-trace-safety
requiredTests:
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "dispatch transcript"
  - pnpm run typecheck
acceptance:
  - Both legacy and namespaced starts correlate with the matching background task.
  - The image appears and progress settles even when ACP replay does not carry the completed image.
  - A fresh session load restores one inline image from the matching transcript and ignores unrelated tool output.
docs:
  required: false
---

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
  - src/lib/acp/timeline-groups.ts
  - src/lib/acp/timeline-types.ts
  - src/lib/acp/reducer.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-timeline-groups.test.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/fixtures/electron.ts
expectedUserBehavior:
  - A user sees the generation indicator after a tool dispatch and the decoded image when the background task finishes in the same chat.
  - Reopening the same conversation restores the image from recorded history without a second generation request.
  - The generation acknowledgment appears before the image in the original assistant turn during live delivery and after reopening the conversation.
  - A confirmed message-tool text receipt stays visible while the task is pending, and remains ahead of its image after a follow-up turn.
  - Reading a file or running a command that prints an image task acknowledgment preserves the normal chat timeline and composer during live updates and replay.
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
  - openclaw-upgrade-persistence
requiredTests:
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-timeline-groups.test.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "dispatch transcript|without image-generation context"
  - pnpm run typecheck
acceptance:
  - Both legacy and namespaced starts correlate with the matching background task.
  - Match sparse ACP tool updates to their original call before recognizing a background image start. A known non-image tool cannot start image polling by returning matching text.
  - The image appears and progress settles even when ACP replay does not carry the completed image.
  - A fresh session load restores one inline image from the matching transcript and ignores unrelated tool output.
  - A Windows profile from ClawX 0.6.1 can open directly in the candidate build and retain its conversation history and settings.
docs:
  required: false
---

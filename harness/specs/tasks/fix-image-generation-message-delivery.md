---
id: fix-image-generation-message-delivery
title: Surface async image-generation message-tool deliveries in Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure generated images delivered through the OpenClaw message tool remain visible in ClawX chat even when Gateway does not append an assistant-media transcript bubble.
touchedAreas:
  - harness/specs/tasks/fix-image-generation-message-delivery.md
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/chat/helpers.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/unit/chat-helpers-enrichment.test.ts
  - tests/unit/chat-page-execution-graph.test.tsx
expectedUserBehavior:
  - When async image generation completes and the message tool returns mediaUrl/mediaUrls, the sourceReply caption and image appear as a final assistant reply.
  - Chat image generation pending state can settle from message-tool delivery records without relying solely on assistant-media bubbles.
  - Renderer continues to use existing Host API / Gateway history paths and does not call Gateway HTTP directly.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
requiredTests:
  - pnpm exec vitest run tests/unit/chat-helpers-enrichment.test.ts tests/unit/chat-page-execution-graph.test.tsx
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts
  - pnpm run typecheck
acceptance:
  - message tool call arguments using media/mediaUrl/mediaUrls are promoted to chat attachments unless a matching internal-UI delivery reply exists.
  - successful internal-UI message tool results with mediaUrl/mediaUrls/sourceReply.mediaUrls become a standalone assistant reply before toolresult rows are filtered.
  - Existing safeguards still avoid promoting arbitrary image paths from read/exec tool output.
docs:
  required: false
---

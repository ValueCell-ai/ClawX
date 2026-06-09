---
id: fix-image-generation-message-delivery
title: Surface async image-generation message-tool deliveries in Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure generated images delivered through the OpenClaw message tool remain visible in ClawX chat even when Gateway does not append an assistant-media transcript bubble.
touchedAreas:
  - harness/specs/tasks/fix-image-generation-message-delivery.md
  - src/stores/chat.ts
  - src/stores/chat/helpers.ts
  - tests/unit/chat-helpers-enrichment.test.ts
  - tests/unit/image-generation-status.test.ts
expectedUserBehavior:
  - When async image generation completes and the message tool returns mediaUrl/mediaUrls, the image appears as a chat attachment.
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
  - pnpm exec vitest run tests/unit/chat-helpers-enrichment.test.ts tests/unit/image-generation-status.test.ts
  - pnpm run typecheck
acceptance:
  - message tool call arguments using media/mediaUrl/mediaUrls are promoted to chat attachments.
  - message tool results with successful mediaUrl/mediaUrls/sourceReply.mediaUrls delivery are promoted to chat attachments before toolresult rows are filtered.
  - Existing safeguards still avoid promoting arbitrary image paths from read/exec tool output.
docs:
  required: false
---

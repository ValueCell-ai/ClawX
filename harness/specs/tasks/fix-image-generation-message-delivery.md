---
id: fix-image-generation-message-delivery
title: Surface async image-generation deliveries in ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure trusted OpenClaw image-generation completion deliveries remain visible in ACP Chat through the bounded compatibility projection.
touchedAreas:
  - harness/specs/tasks/fix-image-generation-message-delivery.md
  - src/lib/acp/image-generation-compat.ts
  - src/lib/acp/reducer.ts
  - src/pages/Chat/index.tsx
  - src/stores/acp-chat-session.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-chat-store.test.ts
expectedUserBehavior:
  - When async image generation completes with trusted internal-UI delivery evidence, the sourceReply caption and image appear in the matching ACP timeline.
  - ACP image-generation pending state settles from accepted completion evidence without relying on a legacy Chat message renderer.
  - Renderer continues to use existing Host API and Host event boundaries and does not call Gateway HTTP directly.
requiredProfiles:
  - fast
  - comms
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
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "projects OpenClaw image-generation"
  - pnpm run typecheck
acceptance:
  - ClawX accepts only trusted ACP or Gateway completion evidence that matches the ACP session and recent image-generation context.
  - Internal-UI sourceReply text remains authoritative for successful media replies and text-only failure replies.
  - Existing safeguards still reject arbitrary image paths and generic tool output without approved image-generation context.
docs:
  required: false
---

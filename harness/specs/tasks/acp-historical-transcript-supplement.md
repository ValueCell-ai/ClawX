---
id: acp-historical-transcript-supplement
title: Supplement ACP historical image completions from transcripts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore historical ACP image-generation previews when OpenClaw ACP loadSession omits async completion assistant messages by cross-checking Main-owned transcript history.
touchedAreas:
  - harness/specs/tasks/acp-historical-transcript-supplement.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - src/lib/acp/image-generation-compat.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Historical ACP Chat sessions show generated image previews when the OpenClaw transcript contains an image_generate start and later assistant MEDIA image completion.
  - Arbitrary assistant MEDIA paths without image-generation context are not projected.
  - Renderer uses hostApi.sessions.history and does not read local transcript files directly.
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
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --grep "hydrates historical image-generation completions"
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Transcript supplement extraction requires a prior image_generate task start in the same session transcript.
  - Historical loadSession triggers a best-effort transcript cross-check only for existing sessions.
  - Supplemented image completions reuse existing Main-owned thumbnail hydration and ACP synthetic append behavior.
  - Code comments document the OpenClaw ACP replay limitation that requires transcript cross-checking.
docs:
  required: false
---

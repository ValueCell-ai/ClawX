---
id: acp-image-generation-compatibility
title: Project OpenClaw image-generation completions into ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore generated image display in ClawX ACP Chat without modifying OpenClaw by projecting trusted Gateway media delivery evidence into the in-memory ACP timeline.
touchedAreas:
  - harness/specs/tasks/acp-image-generation-compatibility.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - src/lib/acp/image-generation-compat.ts
  - src/lib/acp/reducer.ts
  - src/lib/acp/timeline-types.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - ACP Chat first shows the image_generate background task start tool result.
  - When OpenClaw later exposes structured generated-image media through Gateway host events, ClawX appends a new assistant reply containing the hydrated image preview.
  - Arbitrary local paths and generic MEDIA: prose without approved image-generation context are not rendered as images.
  - Renderer continues to use host-api/host-events and does not call Gateway HTTP directly.
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
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "projects OpenClaw image-generation"
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ClawX records recent image_generate background task context from ACP tool output.
  - ClawX accepts only structured Gateway media delivery evidence that matches the active ACP session and recent image-generation context.
  - ClawX hydrates previews through hostApi.media.thumbnails before rendering images.
  - Duplicate completion records do not create duplicate assistant image replies.
  - Stale preview resolution does not append to a different active session or generation.
docs:
  required: true
---

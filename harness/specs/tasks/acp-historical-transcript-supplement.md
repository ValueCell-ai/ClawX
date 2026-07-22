---
id: acp-historical-transcript-supplement
title: Supplement ACP historical image completions from transcripts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore historical ACP image-generation previews when OpenClaw ACP loadSession omits async completion assistant messages by cross-checking Main-owned transcript history.
touchedAreas:
  - harness/specs/tasks/acp-historical-transcript-supplement.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - electron/services/acp-chat-service.ts
  - src/pages/Chat/index.tsx
  - src/lib/acp/image-generation-compat.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/openclaw-prompt-compat.ts
  - src/lib/acp/transcript-supplement.ts
  - src/lib/acp/reducer.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-media-attachments.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Existing historical ACP sessions do not become blank when a newer metadata-only replay ledger exists; explicit session routing falls back to the authoritative transcript.
  - Startup does not create the default ACP session until a Gateway-ready discovery pass confirms that no existing session owns that key.
  - OpenClaw internal image-completion user triggers remain hidden when transcript replay is used.
  - Historical ACP Chat sessions show generated image previews when the OpenClaw transcript contains an image_generate start and later assistant MEDIA image completion correlated to an ACP task/tool anchor, an exactly aligned ACP user turn, or the immediate replay-boundary predecessor.
  - When ACP replay starts after the newer dog turn, the dog image is restored before the replay suffix while an older cat completion does not reappear or append after newer turns.
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
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-media-attachments.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --grep "historical image-generation"
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Existing-session ACP load includes explicit session-key routing metadata, while fresh-session creation remains reserved for keys absent after Gateway-ready discovery.
  - Internal image-completion user triggers are hidden without merging the following assistant completion into an older assistant segment.
  - Transcript supplement extraction requires a prior image_generate task start in the same session transcript.
  - A transcript image task is eligible only when its task id/tool-call id correlates to an ACP image-generation start, its originating transcript user turn aligns exactly to an ACP user turn by prompt projection and duplicate occurrence from the tail, or it is the single image turn immediately preceding the first exact historical match. The boundary exception inserts before the suffix and is disabled when the first ACP turn already has matched image evidence; all other orphaned starts are rejected with reason-coded diagnostics.
  - Historical loadSession triggers a best-effort transcript cross-check only for existing sessions.
  - Supplemented image completions reuse existing Main-owned thumbnail hydration and ACP synthetic append behavior.
  - Code comments document the OpenClaw ACP replay limitation that requires transcript cross-checking.
docs:
  required: true
---

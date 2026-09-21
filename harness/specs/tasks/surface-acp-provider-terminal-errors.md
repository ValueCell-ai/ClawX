---
id: surface-acp-provider-terminal-errors
title: Surface ACP provider terminal errors after partial replies
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve partial assistant output while reporting a true Gateway error terminal as a failed ACP prompt instead of silently settling it as a normal turn.
touchedAreas:
  - harness/specs/tasks/surface-acp-provider-terminal-errors.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - src/pages/Chat/index.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Partial assistant text received before a provider terminal error remains visible.
  - The failed turn shows the provider error after the visible conversation instead of appearing to end normally or placing the only failure indication above a long transcript.
  - Successful, aborted, and max-token prompt settlement remains unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-acp-stream-patch.test.ts tests/unit/chat-acp-inline-timeline.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The pinned OpenClaw ACP bridge rejects a pending prompt when Gateway Chat sends a true error terminal and preserves the producer-provided error message.
  - An error terminal's synthetic message is not projected as assistant prose; assistant deltas already delivered before the terminal remain in the timeline.
  - A prompt error accompanying a non-empty timeline is rendered after the timeline so it is visible beside the interrupted result.
  - An initial load error with no timeline remains visible above the empty state.
  - No Renderer Gateway transport or transcript-derived ordinary-message fallback is introduced.
docs:
  required: true
---

## Incident

A long DeepSeek task persisted a partial final assistant message with `stopReason: "error"` and `errorMessage: "Provider finish_reason: content_filter"`. Gateway emitted a true Chat error terminal, but the pinned ACP adapter converted that terminal to a resolved `end_turn`. ClawX therefore displayed the partial text as if the response had completed normally.

## Scope

Fix terminal semantics at the pinned ACP bridge and place prompt failures after an existing timeline. Do not retry filtered model output automatically, reconstruct the missing suffix from transcript data, or treat synthetic Gateway error prose as assistant content.

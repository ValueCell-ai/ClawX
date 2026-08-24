---
id: fix-acp-multi-message-output-truncation
title: Preserve complete ACP replies across non-prefix chunks
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the bundled OpenClaw ACP bridge from dropping a shorter trailing assistant chunk or slicing a new assistant segment by a stale character count.
touchedAreas:
  - harness/specs/tasks/fix-acp-multi-message-output-truncation.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Assistant prose emitted before tool calls remains visible in its original timeline position.
  - A shorter non-prefix tail after a longer assistant chunk remains visible instead of being dropped.
  - A later independent assistant message is displayed from its first character instead of being sliced by an earlier message length.
  - Monotonically growing snapshots of the same assistant message still emit only their unseen suffix.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - acp-chat-state-and-history
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-acp-stream-patch.test.ts tests/unit/openclaw-restart-recovery-patch.test.ts
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The pinned OpenClaw ACP bridge compares complete prior text, not only its length, when deriving the next ACP text chunk.
  - A strict extension emits only the appended suffix, an identical or stale prefix emits nothing, and a non-prefix assistant update is emitted in full whether it is a trailing fragment or a new message segment.
  - The content-prefix rule is documented as a heuristic compatibility workaround rather than a formally correct classifier for snapshots, chunks, and replacements.
  - A durable follow-up consumes Gateway protocol v4 `deltaText` and `replace` operations under the matching run and defines explicit ACP replacement behavior.
  - Transcript replay remains authoritative and unchanged.
  - Renderer receives ordinary ACP updates and adds no transcript fallback for missing ordinary assistant prose.
docs:
  required: true
---

## Scope

This task patches the pinned OpenClaw ACP live translator. It does not change the Renderer reducer, introduce a second history source, or infer missing prose from transcript files. The patch intentionally provides a bounded loss-avoidance heuristic for the pinned adapter; it does not claim that string prefix relationships can identify protocol operations without ambiguity.

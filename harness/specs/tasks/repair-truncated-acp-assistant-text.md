---
id: repair-truncated-acp-assistant-text
title: Reconcile live ACP assistant text with the persisted transcript
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop a settled ACP turn from leaving a truncated or diverged assistant reply on screen when the persisted OpenClaw transcript already holds the complete text for that turn.
touchedAreas:
  - harness/specs/tasks/repair-truncated-acp-assistant-text.md
  - harness/specs/tasks/fix-acp-multi-message-output-truncation.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/acp-chat.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - src/lib/acp/assistant-text-repair.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/transcript-supplement.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-assistant-text-repair.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - A settled reply whose stream lost its trailing chunk shows the complete text without reloading the conversation.
  - A settled reply already matching the transcript is left byte-identical, with no flicker or re-render.
  - What the user reads immediately after a turn settles matches what the same conversation shows after a reload.
  - Generated-media replies keep their attachment cards and never expose raw `MEDIA:` directive lines as prose.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/acp-assistant-text-repair.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm run typecheck
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --grep "repairs a truncated assistant reply"
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Reconciliation runs only for a live prompt that has already settled, only inside the existing bounded transcript-supplement attempts, and never for historical replay.
  - The turn's transcript assistant texts are paired positionally with that turn's streamed assistant markdown segments, and an ambiguous pairing performs no repair.
  - A paired segment is rewritten only when the transcript projection differs from the streamed text and is not shorter; a shorter, equal, or whitespace-only-different transcript projection leaves the timeline untouched.
  - Transcript text is compared and applied after the same `MEDIA:` directive stripping that OpenClaw ACP applies to the visible reply, so attachment directives are never re-introduced as prose.
  - Repairs are session- and generation-scoped, computed against the committed timeline inside one state commit, idempotent across the retry attempt, and dropped when the operation is superseded.
  - Every repair and every skip reason is recorded on the ACP diagnostics trace so a future truncation can be attributed to a layer instead of guessed.
docs:
  required: true
---

## Scope

`fix-acp-multi-message-output-truncation` hardened the pinned ACP bridge's delta derivation and closed with "Renderer receives ordinary ACP updates and adds no transcript fallback for missing ordinary assistant prose." Field evidence has since shown that a correct bridge is not sufficient: the delta stream crosses a Gateway broadcast that is allowed to drop payloads under back-pressure and several Main/Renderer guards that discard updates silently, so a single lost `agent_message_chunk` leaves a permanently short reply with no recovery path and no trace. This task supersedes that one acceptance line and keeps every other conclusion from it.

The reconciliation is a bounded end-of-turn convergence check, not a second history source. It cannot create turns, segments, tool cards, thoughts, or attachments; it only rewrites the text of assistant markdown segments that the live stream already produced for the settled turn. It is removable once the ACP client consumes Gateway protocol v4 `deltaText`/`replace` operations with explicit sequencing under the matching `runId`, which would make a lost chunk detectable in-band.

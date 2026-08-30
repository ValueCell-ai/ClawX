---
id: repair-acp-replay-integrity
title: Preserve OpenClaw ACP ledger integrity for compaction and terminal text
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure OpenClaw ACP records direct recovery compactions and all buffered terminal assistant text in its event ledger without replacing complete ledger replay from transcript prose.
touchedAreas:
  - harness/specs/tasks/repair-acp-replay-integrity.md
  - harness/specs/tasks/show-acp-compaction-lifecycle.md
  - harness/specs/tasks/hydrate-settled-acp-timeline.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/acp-chat.md
  - docs/*/*.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/lib/acp/reducer.ts
  - src/lib/acp/timeline-types.ts
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpCompactionStatus.tsx
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/e2e/chat-acp-process-timeline.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Automatic overflow, preflight, and timeout recovery compactions appear live and settle in place even when the original embedded AgentSession has already ended.
  - A shorter non-prefix final assistant chunk is emitted and recorded instead of being discarded by a stale character-count comparison.
  - Buffered assistant text carried by an aborted terminal is recorded before the prompt settles as cancelled.
  - Reopening a conversation with a complete ACP event ledger replays that ledger without comparing or substituting transcript prose.
  - Existing persisted ledgers are not migrated or modified by this change.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-acp-stream-patch.test.ts tests/unit/openclaw-acp-compaction-patch.test.ts tests/unit/openclaw-restart-recovery-patch.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-acp-process-timeline.spec.ts
acceptance:
  - Explicit context-engine compaction calls used by overflow, preflight, and timeout recovery emit one structured start and one terminal agent compaction event regardless of the context engine ownsCompaction flag; in-session AgentSession compaction lifecycle remains unchanged.
  - The direct lifecycle reuses one compactionId for start and terminal events, maps aborted work to cancelled, successful work to completed, and incomplete non-aborted work to failed.
  - Incomplete non-aborted direct, command, and session-operation compactions keep source separate from a stable reasonCode and bounded failureReason for recorded ACP projection.
  - Assistant snapshot extensions emit only their unseen suffix, identical or stale prefixes emit nothing, and shorter non-prefix chunks emit in full through the ordinary recorded ACP update path.
  - An aborted Chat terminal carrying buffered assistant text runs that text through the same recorded delta path before prompt cancellation; error-terminal prose is not projected as an ordinary assistant message.
  - Complete ledger replay does not fetch the bounded transcript, run a cross-source selector, strip injected prompt envelopes, or replace ledger events with transcript-derived events.
  - The existing bounded transcript fallback remains limited to cases where the ACP event ledger is unavailable or incomplete.
  - No runtime migration, startup repair, or direct write modifies an existing persisted ACP ledger.
docs:
  required: true
---

## Field Evidence

For `agent:main:session-1788073441789`, the existing ACP replay ledger has
assistant chunk lengths `1`, `103`, `25`, `558`, `597`, and `629`; the durable
assistant response is a strict extension with a final `545`-character suffix.
The pinned adapter's former `fullText.length <= sentSoFar` condition therefore
discarded that final shorter non-prefix chunk deterministically. The missing
compaction came from a separate `ownsCompaction` gate around direct recovery
lifecycle publication after the AgentSession lifecycle had ended.

For `agent:main:session-1788085358142`, the durable final assistant message has
`5733` characters while its complete-marked ACP ledger contains a strict
`5619`-character prefix, leaving a `114`-character suffix unrecorded. The run
settled as aborted after overflow compaction. Gateway's aborted terminal carried
the complete buffered assistant message, but the pinned ACP bridge processed
message content only for delta and final states before cancelling the prompt.

This task repairs those producer paths for future events. It intentionally does
not rewrite the existing field ledger. ClawX remains an ACP consumer and does
not add a parallel transcript text projection.

---
id: recover-compaction-tool-pressure
title: Recover aggregate tool-result pressure and explain compaction failures
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep tool-heavy ACP conversations live when a post-compaction tool turn exceeds the prompt budget, and show a bounded localized failure explanation when recovery cannot complete.
touchedAreas:
  - harness/specs/tasks/recover-compaction-tool-pressure.md
  - harness/specs/tasks/show-acp-compaction-lifecycle.md
  - harness/specs/tasks/hydrate-settled-acp-timeline.md
  - harness/specs/tasks/repair-acp-replay-integrity.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/compaction-context-progress.md
  - harness/reference/acp-chat.md
  - docs/en-US/architecture.md
  - docs/en-US/features.md
  - docs/zh-CN/architecture.md
  - docs/zh-CN/features.md
  - docs/ja-JP/architecture.md
  - docs/ja-JP/features.md
  - docs/ru-RU/architecture.md
  - docs/ru-RU/features.md
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
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-process-timeline.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - A post-compaction tool turn whose individual results fit their limits but whose aggregate text exceeds the current prompt budget truncates enough older tool output to continue instead of repeating no-op compactions.
  - The newest tool-result batch and every tool call/result pairing remain represented after pressure recovery.
  - A real transcript-derived prompt overflow is not treated as a stale session token snapshot merely because compaction reports no real conversation messages.
  - A failed compaction row shows a localized reason label and a bounded producer-provided reason without exposing compaction summaries or arbitrary metadata.
  - Existing persisted transcripts and ACP ledgers are not migrated or modified by this change.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - compaction-context-progress
  - comms-regression
  - e2e-parallel-isolation
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-compaction-tail-patch.test.ts tests/unit/openclaw-acp-compaction-patch.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/i18n-locale-parity.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-acp-process-timeline.spec.ts
acceptance:
  - Pre-prompt pressure uses the measured overflow deficit and the existing truncation buffer to derive an aggregate tool-result target; the same target is used by mid-turn, pre-prompt, and post-compaction truncation.
  - A compact-then-truncate recovery attempts planned aggregate truncation before classifying a no-real-conversation compaction result as stale token state.
  - Aggregate recovery prefers older tool results, preserves a bounded representation for protected trailing results, and never removes tool call/result pairing.
  - Stale session-counter recovery remains available only when transcript or rendered prompt pressure does not prove a real overflow.
  - Compaction metadata keeps source separate from optional reasonCode and reason fields; reason values are trimmed, bounded, recorded in the ACP ledger, and accepted only as typed version 1 metadata.
  - Renderer displays the reason only for failed compaction items, localizes its label in every shipped locale, and keeps historical rows non-announcing.
  - Complete ACP ledger replay remains authoritative, and no startup repair or migration writes to existing user data.
docs:
  required: true
---

## Field Evidence

For `agent:main:session-1788086801204`, the first overflow compaction completed,
then one unfinished tool turn accumulated eleven tool results totaling `131190`
characters. No individual result exceeded `22020` characters, so the static
per-result and aggregate guards reported `toolResultReducibleChars=0` even
though the rendered prompt estimate was `92662` tokens against a `78000` token
prompt budget. Subsequent compaction attempts returned
`no real conversation messages` because the compacted tail contained tool calls
and tool results but no new assistant prose. The stale-snapshot branch retried
the same real pressure three times and the run failed.

This task repairs future recovery and observability only. The field transcript,
session index, and ACP ledger remain read-only evidence.

---
id: show-acp-compaction-lifecycle
title: Show OpenClaw compaction lifecycle in ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve historical OpenClaw compaction boundaries and live compaction lifecycle state in ACP Chat without inferring compaction from text, usage changes, or stderr.
touchedAreas:
  - harness/specs/tasks/show-acp-compaction-lifecycle.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/reference/acp-chat.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - src/lib/acp/timeline-types.ts
  - src/lib/acp/reducer.ts
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpCompactionStatus.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/e2e/chat-acp-process-timeline.spec.ts
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Each persisted OpenClaw transcript compaction boundary included in the bounded ACP transcript response renders in its original replay position as a localized completed compaction marker.
  - A live compaction marker first shows in progress, then updates in place to completed, failed, or cancelled; successful compaction that will retry the interrupted model call says that work is continuing.
  - Multiple compactions in one conversation remain separate ordered markers, including multiple occurrences during one run.
  - Compaction summaries and other compacted conversation content are never displayed by the marker.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - ui-i18n-design-tokens
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/openclaw-acp-compaction-patch.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/chat-acp-process-timeline.spec.ts --grep "compaction"
acceptance:
  - The patched OpenClaw ACP adapter emits a standard session_info_update whose _meta contains openclaw.ai/compaction version 1 metadata for live and replayed compactions because the pinned ACP SDK does not yet accept the draft compaction_update discriminator.
  - Every metadata payload has a non-empty compactionId, a valid status, and a source; optional runId, willRetry, and timestamp fields are typed and omitted when unavailable.
  - One live occurrence reuses its compactionId from in_progress through its terminal update, while every later occurrence receives another compactionId even when the runId is unchanged.
  - AgentSession threshold compaction, owning context-engine preflight or overflow recovery, and the actual /compact command publish structured agent compaction lifecycle events consumed by ACP.
  - Direct sessions.compact operations publish their start and terminal state through the session.operation lifecycle consumed by ACP.
  - Transcript fallback replay maps each persisted type compaction entry present in the bounded sessions.get response to one completed marker keyed by that entry's durable id and preserves response order when the ACP event ledger is unavailable; it does not claim to load unbounded transcript history.
  - Renderer accepts only version 1 compaction metadata with a non-empty ID, valid status, and valid source, and ignores malformed or unrelated metadata without changing the timeline.
  - Renderer closes open message segments before inserting a new compaction item and updates the exact compaction item in place for later metadata carrying the same ID.
  - Terminal state mapping is completed for successful work, cancelled for an aborted operation, and failed for an incomplete non-aborted operation.
  - No stderr parsing, token-usage drop detection, ordinary assistant text matching, or direct Renderer Gateway call is added.
  - All user-visible labels are localized in en, zh, ja, and ru and use existing design tokens.
docs:
  required: true
---

## Compatibility Contract

Until the pinned ACP SDK supports the draft Session Compaction RFD update, OpenClaw sends this metadata on a standard `session_info_update`:

```json
{
  "sessionUpdate": "session_info_update",
  "_meta": {
    "openclaw.ai/compaction": {
      "version": 1,
      "compactionId": "cmp-unique-occurrence",
      "status": "in_progress",
      "source": "threshold",
      "runId": "optional-run-id",
      "timestamp": "2026-08-30T00:00:00.000Z"
    }
  }
}
```

`status` is one of `in_progress`, `completed`, `failed`, or `cancelled`.
`source` is one of `threshold`, `overflow`, `preflight`, `manual`, or
`transcript`. The metadata is a compatibility extension, not a parallel
transport. Remove its producer and Renderer validator, and consume the native
Session Compaction RFD update instead, once the pinned ACP SDK accepts that
update and the distributed OpenClaw adapter emits it for the same live and
replay paths.

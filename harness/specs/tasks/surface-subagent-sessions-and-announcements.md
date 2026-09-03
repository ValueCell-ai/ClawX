---
id: surface-subagent-sessions-and-announcements
title: Preserve post-prompt announcements and subagent classification
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve native OpenClaw subagent classification after its navigation moved into parent Chat, and preserve main-session assistant announcements both live and after ACP replay has settled.
touchedAreas:
  - harness/specs/tasks/surface-subagent-sessions-and-announcements.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/sidebar-session-attention-authority.md
  - harness/reference/acp-chat.md
  - harness/reference/chat-workspace-and-navigation.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/components/layout/Sidebar.tsx
  - src/stores/chat/session-key-utils.ts
  - tests/unit/session-key-utils.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
expectedUserBehavior:
  - A native `agent:<agentId>:subagent:<id>` session no longer appears in the sidebar, but remains in the shared session catalog for exact-key status, attention, routing, workspace cleanup, and deletion behavior.
  - Parent Chat presents direct children using ACP lineage and titles; the leading `[Subagent Context]` marker is removed only from displayed child titles without changing OpenClaw session data or non-subagent titles.
  - Assistant text from a later `announce:v1` run appears incrementally while its parent session remains loaded, even after the original ACP prompt settled.
  - Reopening the parent session preserves exact complete-ledger replay and appends only durable transcript records newer than the ledger high-water timestamp.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - sidebar-session-attention-authority
  - ui-i18n-design-tokens
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/session-key-utils.test.ts tests/unit/openclaw-acp-stream-patch.test.ts
  - pnpm exec playwright test tests/e2e/chat-sidebar-session-attention.spec.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Native subagent classification derives from the exact third canonical key segment and does not parse transcript prose or classify `agent:<id>:acp:<id>` as a native subagent.
  - Sidebar hiding is presentation-only: native child rows remain in the shared catalog, and parent Chat removes the leading context marker only in ClawX display state; no OpenClaw transcript, session row, or title is mutated.
  - A loaded session retains one passive session-message subscription independently of prompt-lifetime subscription references and releases or replaces it on close, shutdown, or active-session replacement.
  - A no-pending `announce:v1` Chat delta or final for the exact loaded session is projected through ordinary recorded ACP updates with run-scoped snapshot reconciliation. The same path accepts an ordinary run only for an exact loaded canonical native subagent and carries its assistant, thought, and tool lifecycle updates while preserving cumulative text baselines across tool boundaries; unrelated sessions, malformed child keys, and ordinary parent run IDs remain ignored.
  - An ambient terminal records a later session snapshot checkpoint so a subsequent transcript-tail replay cannot duplicate text already captured live.
  - Complete ledger events remain unchanged and ordered; bounded transcript replay contributes only records with finite timestamps strictly newer than the maximum finite ledger event timestamp.
  - Transcript records at or before the high-water timestamp, records without a finite timestamp, and transcript-fetch failures do not replace, compare with, or remove complete ledger events.
  - ClawX Main and Renderer continue to consume only ACP session updates for ordinary assistant history.
docs:
  required: true
---

## Field Evidence

Session `agent:main:session-1788111066745` completed its original ACP-backed run
at 2026-08-30 17:35 UTC. Its complete ledger ended before two later synthetic
`announce:v1` runs appended assistant records to the same durable transcript.
OpenClaw WebUI displayed `第一次「检查一下」——两个已完成，一个大任务还在跑` and
the final completion, while ClawX replayed only the earlier ledger. The child
sessions use canonical keys under `agent:main:subagent:<uuid>`. Their former
ordinary sidebar-row presentation is superseded by
`embed-subagent-sessions-in-parent-chat`: current ClawX hides those rows only in
sidebar presentation and exposes direct children from ACP inside parent Chat.

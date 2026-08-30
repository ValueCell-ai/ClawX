---
id: surface-subagent-sessions-and-announcements
title: Surface subagent sessions and post-prompt announcements
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Identify native OpenClaw subagent sessions in the sidebar and preserve main-session assistant announcements both live and after ACP replay has settled.
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
  - A native `agent:<agentId>:subagent:<id>` row remains selectable in the normal workspace session list but carries a localized BotMessageSquare subagent tag before its title.
  - The leading `[Subagent Context]` marker is removed from that row's displayed title without changing OpenClaw session data or non-subagent titles.
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
  - Sidebar presentation uses the localized subagent tag and removes the leading context marker only in ClawX display state; no OpenClaw transcript, session row, or title is mutated.
  - A loaded session retains one passive session-message subscription independently of prompt-lifetime subscription references and releases or replaces it on close, shutdown, or active-session replacement.
  - A no-pending `announce:v1` Chat delta or final for the exact loaded session is projected through ordinary recorded ACP updates with run-scoped snapshot reconciliation; unrelated or normal settled run IDs are ignored by this ambient path.
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
sessions use canonical keys under `agent:main:subagent:<uuid>` and currently
surface their `[Subagent Context]` marker as an ordinary sidebar title prefix.

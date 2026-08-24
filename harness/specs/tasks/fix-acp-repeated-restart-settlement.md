---
id: fix-acp-repeated-restart-settlement
title: Settle ACP prompts after repeated Gateway restarts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reconcile ACP prompts from run-scoped persisted terminal state when Gateway restarts after the final response was written but before terminal delivery.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/en-US/architecture.md
  - docs/zh-CN/architecture.md
  - docs/ja-JP/architecture.md
  - docs/ru-RU/architecture.md
  - harness/specs/tasks/fix-acp-multi-message-output-truncation.md
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/fix-acp-repeated-restart-settlement.md
  - tests/unit/openclaw-restart-recovery-patch.test.ts
expectedUserBehavior:
  - A prompt recovered through one or more Gateway restarts leaves the executing state when its current recovery run reaches a terminal state.
  - A later unrelated run cannot settle an older pending prompt from stale session state.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - gateway-readiness-policy
  - acp-chat-state-and-history
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/openclaw-restart-recovery-patch.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Startup orphan recovery replaces restartRecoveryDeliverySourceRunId with the current lifecycleRunId so every recovery run names its directly interrupted predecessor.
  - Startup orphan recovery retires restartRecoveryRuns markers inherited from a prior process so a guarded-then-hard-crash chain cannot select stale lineage.
  - Session lifecycle persistence retains the latest lifecycleRunId after terminal settlement and overwrites it on the next run start.
  - A unique guarded restartRecoveryRuns marker takes precedence over older persisted delivery lineage when selecting the direct predecessor.
  - ACP supplies both the current run id and session key when reconciling agent.wait after a disconnect.
  - Gateway falls back for done, failed, timeout, and killed session states only when lifecycleRunId exactly matches the requested run id and session key; an unrelated run or session still times out.
  - The fix remains in the pinned OpenClaw generated-dist patch and is exercised against the installed patched runtime.
docs:
  required: true
---

## Incident

The captured session began as ACP run `3cb9d54f-e999-458b-9bdc-8955e428e511` and was resumed as `bcd8a184-7232-4fae-9015-5b5e4fbfc07e`. The recovery run persisted its final assistant response and recorded a successful session end, while the later session row was `failed` and `abortedLastRun` with the same run still recorded as its lifecycle owner. Reconnect reconciliation queried `agent.wait` with `timeoutMs: 0`, whose original implementation returned no terminal snapshot whenever its process-local cache was absent. This left ACP without a durable way to settle the prompt even though the run outcome was persisted.

## Scope

Keep direct predecessor lineage across a continuous restart-recovery chain. Make terminal reconciliation durable and run-scoped by pairing `agent.wait` with the known session key and matching the persisted lifecycle owner. Do not infer completion from transcripts, unscoped session status, or Renderer timers.

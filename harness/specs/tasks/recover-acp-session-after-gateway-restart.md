---
id: recover-acp-session-after-gateway-restart
title: Continue an ACP prompt through Gateway restart recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Preserve an accepted ACP prompt while OpenClaw replaces an interrupted run with an explicitly linked restart-recovery run.
touchedAreas:
  - .gitignore
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/en-US/architecture.md
  - docs/zh-CN/architecture.md
  - docs/ja-JP/architecture.md
  - docs/ru-RU/architecture.md
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/recover-acp-session-after-gateway-restart.md
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - patches/openclaw@2026.7.1-2.patch
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - An accepted ACP prompt stays pending for up to 60 seconds while the Gateway reconnects and OpenClaw starts restart recovery; a send that was never acknowledged retains the 5-second disconnect deadline.
  - Events from the explicitly linked recovery run continue the original in-memory turn and settle its original prompt.
  - Recovered text, tool activity, approvals, cancellation, and terminal state use the new run id without a Renderer session reload; tool calls keep text segments on either side distinct.
  - After ClawX restarts, ACP `session/load` restores persisted transcript tool calls and results as native tool updates in their original order between assistant text segments.
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
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --project=parallel --grep "renders ledger-style replayed ACP tool events"
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The unique interrupted run id is propagated only by trusted main-session restart recovery and never inferred from a session key.
  - Chat and agent events expose `resumedFromRunId`, and ACP adopts the new run only when it matches the pending prompt.
  - Adoption clears the stale disconnect deadline, resets per-run stream state, rebinds cancellation, and retains tool and approval delivery after reconnect.
  - Visible recovery tool events reach the exact session-message subscription with `resumedFromRunId`, even when no global session-event subscription exists.
  - Reconnect reconciliation waits for the exact session-message subscription request to settle, so recovery dispatch cannot race ahead of tool-event registration.
  - OpenClaw's ACP transcript fallback maps persisted assistant `toolCall` blocks and `toolResult` messages to `tool_call` and `tool_call_update` rather than flattening adjacent assistant text.
  - String-valued and structured transcript tool results retain visible output in the replayed tool card.
  - The initial 5-second disconnect check extends only acknowledged prompts to a bounded 60-second total recovery window; unacknowledged prompts still reject after 5 seconds.
  - Renderer remains unchanged and ACP replay remains the source of truth for persisted Chat history.
docs:
  required: true
---

## Original Problem

If the Gateway restarted while the AI was replying, ClawX could reconnect to the replacement Gateway process but the active ACP conversation did not resume. OpenClaw could start a restart-recovery run and continue producing output, while ClawX remained frozen at the last text received before the disconnect. The original `session/prompt` eventually failed or stayed disconnected from the replacement run because ACP still identified the turn by the interrupted run id and had no trusted lineage proving that the new run continued it.

The failure was not limited to the live UI. Even when OpenClaw completed and persisted the recovered response, restarting ClawX and selecting the same conversation could still replay only the timeline prefix that existed before the disconnect. The ACP event history associated with the original prompt had not received the replacement run's events, and transcript fallback did not preserve the complete native timeline: it projected text and thinking while dropping persisted `toolCall` and `toolResult` records. Missing tool events also removed the boundaries between assistant text segments around those calls.

The broken flow therefore had two related symptoms:

- Live recovery: Gateway connectivity returned, but the replacement run's text, tools, approvals, cancellation target, and terminal state did not settle the original in-memory ACP prompt.
- Reload recovery: after restarting ClawX, `session/load` could reproduce the stale pre-disconnect view or an incomplete flattened response instead of the recovered conversation that OpenClaw had persisted.

## Fix

`patches/openclaw@2026.7.1-2.patch` is the ClawX-local backport applied to the pinned `openclaw@2026.7.1-2` runtime. It restores one explicit recovery chain from the interrupted run through live ACP delivery and persisted replay:

- Persist the active lifecycle run id before a restart and allow only trusted `main_session_restart_recovery` provenance to pass it into a distinct replacement run as `internalRestartRecoverySourceRunId`.
- Project that source id as `resumedFromRunId` on Chat, agent, tool, and approval events. ACP adopts a replacement run only when this value exactly matches its pending prompt; it never infers lineage from a shared session key.
- Keep an acknowledged prompt pending for a bounded 60-second total recovery window while retaining the original 5-second deadline for a send that was never acknowledged. Adoption clears the stale disconnect deadline, resets per-run text, thought, and tool state, rebinds cancellation, and lets the replacement terminal event settle the original prompt.
- Re-register the exact `sessions.messages.subscribe` subscription before reconnect reconciliation can dispatch recovery work. Gateway mirrors visible recovery tool events to that exact subscriber, includes `resumedFromRunId`, and deduplicates clients that already receive the run-scoped event.
- When a complete structured ACP ledger is unavailable, map persisted assistant `toolCall` blocks and `toolResult` messages to native `tool_call` and `tool_call_update` updates in transcript order. Both structured and string-valued results retain visible output, and a text-tool-text sequence reloads as two distinct assistant text segments around the tool card.

ClawX Renderer remains unchanged. It continues to reduce standard ACP updates into one in-memory timeline; the repair is in OpenClaw's recovery lineage, Gateway event projection, ACP prompt reconciliation, and ACP replay fallback.

The same source-level fixes will be submitted to the OpenClaw upstream repository as a pull request. This local generated-dist patch is a temporary compatibility measure: after the upstream PR is merged and ClawX upgrades to an OpenClaw release containing the fixes, `patches/openclaw@2026.7.1-2.patch` should be removed rather than carried forward to a newer generated bundle.

## Scope

The dependency patch backports current OpenClaw run-lineage, recovered tool delivery, and native ACP transcript replay behavior to the pinned `openclaw@2026.7.1-2` runtime. It patches generated runtime chunks and declarations, so every OpenClaw version change must regenerate and review the patch rather than carrying it forward by filename.

---
id: keep-acp-recovery-through-managed-restart
title: Keep ACP recovery alive through managed Gateway restart
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep an accepted ACP prompt recoverable for a policy-derived ten-minute managed-restart window, and avoid renderer-only reload races.
touchedAreas:
  - electron/gateway/recovery-budget.ts
  - electron/gateway/manager.ts
  - electron/main/menu.ts
  - electron/services/acp-chat-service.ts
  - harness/reference/acp-chat.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/tasks/keep-acp-recovery-through-managed-restart.md
  - harness/specs/tasks/recover-acp-session-after-gateway-restart.md
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - src/stores/acp-chat-session.ts
  - tests/e2e/main-navigation.spec.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/gateway-recovery-budget.test.ts
  - tests/unit/menu.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
expectedUserBehavior:
  - An accepted ACP prompt remains attached while four heartbeat misses and a slow managed Gateway restart complete.
  - A renderer without the in-memory live snapshot waits for the active prompt to settle and then replays history instead of reporting ACP session load failed.
  - Reload and Force Reload remain available from the View menu but have no application accelerator.
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
  - pnpm exec vitest run tests/unit/gateway-recovery-budget.test.ts tests/unit/openclaw-restart-recovery-patch.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-chat-store.test.ts tests/unit/menu.test.ts
  - pnpm exec playwright test tests/e2e/main-navigation.spec.ts --project=parallel --grep "reload menu" --no-deps
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The accepted-prompt recovery grace is derived from the same heartbeat and ready-probe constants used by GatewayManager, remains intentionally shorter than the general cold-start retry ceiling, and is passed to the ACP child through Main-owned environment configuration.
  - The recovery budget keeps the unacknowledged-send deadline unchanged and documents why its current inputs produce approximately ten minutes.
  - A cold Renderer retries active-prompt session loading with a delay until authoritative ACP replay is available; it does not immediately repeat once and convert a successful live response into failure.
  - Reload menu commands remain clickable while no Cmd/Ctrl+R or force-reload accelerator is registered.
  - No prompt-settlement host event, Renderer transcript polling, or OpenClaw upstream source change is introduced.
docs:
  required: true
---

## Incident

The ACP bridge dropped an accepted prompt before ClawX's fourth heartbeat miss restarted the Gateway. OpenClaw later recovered the durable session and continued producing output, but the original ACP prompt was no longer present to adopt the replacement run. A renderer-only reload could then retry the same active-prompt load response and surface a synthetic load failure.

## Scope

This task adjusts the existing ClawX-local OpenClaw patch and Main-owned process configuration. It deliberately leaves OpenClaw upstream work and a durable prompt-settlement protocol out of scope.

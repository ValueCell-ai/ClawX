---
id: fix-acp-child-orphan-on-quit
title: Terminate the openclaw-acp child process on app quit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: ClawX never signalled its forked openclaw-acp child on quit, so the child outlived the app by reconnecting to the Gateway after the Gateway itself was stopped.
touchedAreas:
  - electron/services/acp-chat-service.ts
  - electron/main/index.ts
  - tests/unit/acp-chat-service.test.ts
  - harness/reference/acp-chat.md
  - harness/specs/tasks/fix-acp-child-orphan-on-quit.md
expectedUserBehavior:
  - Quitting ClawX (window close on Win/Linux, Cmd+Q on macOS, SIGINT/SIGTERM) terminates the openclaw-acp child process instead of leaving an orphan.
  - ACP chat keeps working after relaunch; a stopped child is replaced by a fresh fork on the next session load.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - acp-chat-state-and-history
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/acp-chat-service.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - AcpChatService exposes stop() that sends SIGTERM to the owned child, waits a bounded grace, and escalates to SIGKILL before resolving.
  - stop() is a no-op when no child was spawned or the child already exited, and resolves pending permission waiters as cancelled through the existing child-exit drop path.
  - The before-quit handler awaits ACP child termination before gatewayManager.stop() so the agent cannot enter its Gateway-recovery reconnect loop, while the existing 5s quit race budget still bounds the whole cleanup.
  - createAcpChatService registers the active instance retrievable via getActiveAcpChatService() so the quit path needs no new wiring through chat-api.
docs:
  required: false
---

## Incident

`openclaw-acp` (the `openclaw.mjs acp` child forked by `AcpChatService.spawnConnection`) stayed alive after quitting ClawX. Root causes: the service had no kill path outside the malformed-stdio guard; `before-quit` only stopped the Gateway UtilityProcess and extensions; and the OpenClaw ACP agent shuts down only on SIGINT/SIGTERM — it does not watch stdin EOF or its parent PID and reconnects when the Gateway disappears, so parent death orphaned it indefinitely.

## Scope

Own the child lifecycle in Main: add a bounded SIGTERM→SIGKILL `stop()` on `AcpChatService`, expose the active instance for the quit path, and run it ahead of `gatewayManager.stop()` inside the existing `before-quit` race. Do not change ACP message flow, spawn options, or renderer behavior.

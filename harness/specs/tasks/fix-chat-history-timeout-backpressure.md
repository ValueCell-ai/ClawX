---
id: fix-chat-history-timeout-backpressure
title: Fix chat history timeout under large histories and RPC fan-out
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent large transcript history reads and background session-label fan-out from starving Gateway RPCs.
touchedAreas:
  - harness/specs/tasks/fix-chat-history-timeout-backpressure.md
  - package.json
  - pnpm-lock.yaml
  - patches/openclaw@2026.4.23.patch
  - electron/gateway/manager.ts
  - electron/main/ipc-handlers.ts
  - src/stores/chat.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-history-startup-retry.spec.ts
  - tests/e2e/chat-history-timeout-backpressure.spec.ts
expectedUserBehavior:
  - ClawX remains responsive when the user has many sidebar sessions and large chat transcripts.
  - Sidebar session labels do not trigger a burst of background chat.history RPCs at Gateway readiness.
  - Active chat history loads are prioritized over background label refreshes.
  - A persistently unresponsive Windows Gateway is recovered instead of remaining in a running-but-dead state.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
requiredTests:
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/e2e/chat-history-timeout-backpressure.spec.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway HTTP directly.
  - Background label fetches are concurrency-limited and cancellable.
  - Main-process chat.history RPCs are single-flighted/backpressured before reaching the Gateway.
  - OpenClaw chat.history no longer parses the full transcript when only the latest limited messages are requested.
  - Windows heartbeat recovery is guarded against transient misses but recovers sustained Gateway unresponsiveness.
docs:
  required: false
---

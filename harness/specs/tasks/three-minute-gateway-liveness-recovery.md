---
id: three-minute-gateway-liveness-recovery
title: Recover an owned Gateway after three minutes without liveness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Eliminate pong-only Gateway restarts while retaining bounded automatic recovery for an unavailable ClawX-owned Gateway.
touchedAreas:
  - docs/**
  - harness/specs/tasks/three-minute-gateway-liveness-recovery.md
  - harness/specs/tasks/restore-gateway-heartbeat-recovery-after-four-misses.md
  - harness/specs/tasks/make-gateway-heartbeat-observability-only.md
  - harness/specs/rules/gateway-heartbeat-safety.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - electron/gateway/recovery-controller.ts
  - electron/gateway/recovery-budget.ts
  - electron/gateway/connection-monitor.ts
  - electron/gateway/manager.ts
  - electron/gateway/restart-governor.ts
  - electron/gateway/restart-controller.ts
  - electron/gateway/capability-monitor.ts
  - electron/utils/gateway-health.ts
  - electron/services/diagnostics-api.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - src/lib/host-api.ts
  - src/pages/Channels/index.tsx
  - tests/unit/gateway-connection-monitor.test.ts
  - tests/unit/gateway-recovery-budget.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-restart-governor.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
  - tests/e2e/channels-health-diagnostics.spec.ts
  - vitest.config.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Missed Gateway pong frames do not automatically restart the Gateway before the three-minute liveness deadline.
  - A pong, any incoming Gateway frame, or a successful Gateway RPC resets the liveness deadline.
  - At the three-minute deadline, ClawX verifies the core RPC router with system-presence before restarting an owned Gateway.
  - A successful deadline probe does not reconnect or restart Gateway.
  - A failed deadline probe restarts only a Gateway process owned by ClawX.
  - A failed deadline probe for an external Gateway does not stop or restart it automatically.
  - Process exit, WebSocket close, explicit restart, and code-1012 reconnect behavior remain unchanged.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - gateway-heartbeat-safety
  - gateway-readiness-policy
  - backend-communication-boundary
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-restart-governor.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
  - tests/e2e/channels-health-diagnostics.spec.ts
acceptance:
  - The only heartbeat-derived automatic restart path requires 180 seconds without a trusted liveness signal and a failed system-presence probe with a 5000ms timeout.
  - The 180-second deadline runs exactly one system-presence probe per silence generation.
  - Consecutive heartbeat misses remain diagnostic evidence and do not directly terminate a socket, process, or call GatewayManager.restart on any platform.
  - A successful deadline system-presence probe records liveness and cancels recovery without reconnecting or restarting.
  - A failed deadline probe calls the guarded restart path exactly once for an owned Gateway when auto-recovery is enabled and lifecycle state permits it.
  - Automatic recovery never calls stop, shutdown, or restart for an external Gateway; it may only reconnect ClawX's transport and report unavailable diagnostics.
  - A pong, any incoming message, or successful RPC before the deadline resets the silence sequence.
  - Code 1012 reload, child-process exit, explicit restart, and normal socket-close recovery do not race or duplicate deadline escalation.
  - Diagnostics include sanitized liveness recovery state and reason through the existing host API.
  - No chat, tool, cron, or workload tracking is added.
docs:
  required: true
---

This task supersedes the current four-consecutive-misses process-restart policy. The one three-minute liveness deadline is intentional: it prevents a short missed-pong sequence from interrupting a functioning Gateway while keeping automatic recovery bounded for a ClawX-owned process that cannot serve its core RPC router.

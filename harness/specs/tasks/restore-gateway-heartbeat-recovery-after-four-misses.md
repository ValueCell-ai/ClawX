---
id: restore-gateway-heartbeat-recovery-after-four-misses
title: Restore Gateway heartbeat recovery after four misses
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Recover a persistently unresponsive local Gateway automatically while giving long-running work a bounded heartbeat window before process replacement.
touchedAreas:
  - harness/specs/tasks/restore-gateway-heartbeat-recovery-after-four-misses.md
  - harness/specs/tasks/make-gateway-heartbeat-observability-only.md
  - harness/specs/rules/gateway-heartbeat-safety.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - electron/gateway/manager.ts
  - electron/utils/gateway-health.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - One to three consecutive missed Gateway heartbeat responses remain diagnostic-only and do not interrupt long-running work.
  - Four consecutive missed heartbeat responses mark the Gateway unresponsive and request an automatic restart when lifecycle auto-recovery is enabled and the Gateway is still running.
  - A pong or any incoming Gateway message before the fourth miss resets the consecutive-miss counter.
  - Process exit, WebSocket close, explicit restart, and code-1012 reconnect behavior remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-heartbeat-safety
  - gateway-readiness-policy
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-connection-monitor.test.ts
acceptance:
  - The Gateway heartbeat threshold is four consecutive misses.
  - Misses one through three update monitor state without calling GatewayManager.restart or terminating the socket.
  - The fourth consecutive miss records timeout diagnostics and calls GatewayManager.restart exactly once when auto-recovery is allowed.
  - The fourth miss does not restart when auto-reconnect is disabled or the Gateway is not running.
  - Recovery through a pong or any incoming Gateway message resets the sequence, so only four new consecutive misses can trigger recovery.
  - Automatic heartbeat recovery behaves consistently on Windows, macOS, and Linux.
  - Documentation in all maintained README translations describes the four-miss automatic recovery policy.
docs:
  required: true
---

This task supersedes the recovery policy from `make-gateway-heartbeat-observability-only`: heartbeat misses remain non-authoritative during the first three misses, while a fourth consecutive miss is treated as persistent unresponsiveness and may request guarded lifecycle recovery.

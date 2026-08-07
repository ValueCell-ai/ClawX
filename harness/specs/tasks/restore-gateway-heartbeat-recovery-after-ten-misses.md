---
id: restore-gateway-heartbeat-recovery-after-ten-misses
title: Restore Gateway heartbeat recovery after ten misses
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Recover a persistently unresponsive local Gateway automatically while giving long-running work a longer heartbeat window before process replacement.
touchedAreas:
  - harness/specs/tasks/restore-gateway-heartbeat-recovery-after-ten-misses.md
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
  - One to nine consecutive missed Gateway heartbeat responses remain diagnostic-only and do not interrupt long-running work.
  - Ten consecutive missed heartbeat responses mark the Gateway unresponsive and request an automatic restart when lifecycle auto-recovery is enabled and the Gateway is still running.
  - A pong or any incoming Gateway message before the tenth miss resets the consecutive-miss counter.
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
  - The Gateway heartbeat threshold is ten consecutive misses.
  - Misses one through nine update monitor state without calling GatewayManager.restart or terminating the socket.
  - The tenth consecutive miss records timeout diagnostics and calls GatewayManager.restart exactly once when auto-recovery is allowed.
  - The tenth miss does not restart when auto-reconnect is disabled or the Gateway is not running.
  - Recovery through a pong or any incoming Gateway message resets the sequence, so only ten new consecutive misses can trigger recovery.
  - Automatic heartbeat recovery behaves consistently on Windows, macOS, and Linux.
  - Documentation in all maintained README translations describes the ten-miss automatic recovery policy.
docs:
  required: true
---

This task supersedes the recovery policy from `make-gateway-heartbeat-observability-only`: heartbeat misses remain non-authoritative during the first nine misses, while a tenth consecutive miss is treated as persistent unresponsiveness and may request guarded lifecycle recovery.

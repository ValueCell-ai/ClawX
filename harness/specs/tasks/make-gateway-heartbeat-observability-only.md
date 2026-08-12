---
id: make-gateway-heartbeat-observability-only
title: Make Gateway heartbeat misses observability-only
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent long-running OpenClaw work from being interrupted when the Gateway control plane temporarily stops answering WebSocket ping frames.
touchedAreas:
  - harness/specs/tasks/make-gateway-heartbeat-observability-only.md
  - harness/specs/rules/gateway-heartbeat-safety.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - electron/gateway/manager.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Long-running model, tool, and scheduled tasks are not interrupted solely because Gateway pong frames are delayed.
  - Consecutive heartbeat misses still mark Gateway health as unresponsive and remain visible in diagnostics.
  - A real Gateway process exit or WebSocket close continues to use the existing reconnect and crash-recovery paths.
  - Users can still explicitly restart Gateway when they decide recovery is necessary.
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
  - Reaching the consecutive heartbeat miss threshold records heartbeat timeout diagnostics but does not terminate the socket or call GatewayManager.restart on any platform.
  - Heartbeat recovery through a pong or any incoming Gateway message resets the miss counter as before.
  - Gateway health becomes unresponsive at the existing miss threshold.
  - Process exit, socket close, explicit restart, and code-1012 reconnect behavior are unchanged.
  - The initial gateway.ready heartbeat restart timer is removed because heartbeat misses no longer own process recovery.
  - README translations describe heartbeat misses as diagnostic evidence rather than a process-restart trigger.
docs:
  required: true
---

Historical first-stage heartbeat safety task. Its observability-only recovery policy is superseded by `restore-gateway-heartbeat-recovery-after-four-misses`, which keeps the first three misses diagnostic-only and permits guarded recovery on the fourth consecutive miss.

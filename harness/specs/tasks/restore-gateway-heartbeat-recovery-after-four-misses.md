---
id: restore-gateway-heartbeat-recovery-after-four-misses
title: Historical: Gateway heartbeat recovery after four misses
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Historical record of the superseded four-miss recovery proposal; it must not guide current Gateway lifecycle behavior.
touchedAreas:
  - harness/specs/tasks/restore-gateway-heartbeat-recovery-after-four-misses.md
  - harness/specs/tasks/three-minute-gateway-liveness-recovery.md
expectedUserBehavior:
  - This historical task does not define current user behavior.
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
  - Do not implement this historical task; use three-minute-gateway-liveness-recovery for the current liveness policy.
docs:
  required: false
---

Historical task superseded by `three-minute-gateway-liveness-recovery`. Its four-miss direct-restart proposal is retained only as context; the current policy is one 180-second no-liveness deadline, followed by a single `system-presence` verification before ClawX may restart only a Gateway process it owns.

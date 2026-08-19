---
id: make-gateway-heartbeat-observability-only
title: Historical: Gateway heartbeat misses observability-only
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Historical record of the superseded observability-only heartbeat proposal; it must not guide current Gateway lifecycle behavior.
touchedAreas:
  - harness/specs/tasks/make-gateway-heartbeat-observability-only.md
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

Historical task superseded by `three-minute-gateway-liveness-recovery`. Its observability-only heartbeat proposal is retained only as context and must not be implemented; the canonical task defines the current liveness policy.

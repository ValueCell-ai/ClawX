---
id: limit-gateway-stall-amplification
title: Bound overlapping config reads during a Gateway stall
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent adjacent config readers from waiting through successive timeouts and make automatic liveness recovery identifiable in issue reports.
touchedAreas:
  - harness/specs/tasks/limit-gateway-stall-amplification.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/gateway/config-delivery.ts
  - electron/gateway/manager.ts
  - electron/services/channels-api.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/host-services.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Overlapping config readers share one outstanding read and each receives its own snapshot.
  - Issue reports distinguish a verified automatic Gateway restart and the duration of a channel status RPC from the wait for configuration.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-config-delivery
  - gateway-heartbeat-safety
  - gateway-diagnostic-logging
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/host-services.test.ts
acceptance:
  - Concurrent readers share an outstanding success or failure, and the next read after settlement obtains a fresh snapshot.
  - A read submitted on a new Gateway connection cannot inherit the previous connection's pending result.
  - A queued mutation or secrets reload separates read groups. Nested reads see the active mutation, and later callers cannot mutate another caller's snapshot.
  - Only an approved owned-process liveness escalation logs its trigger. Existing deadline, probe, ownership, and governor safeguards still apply.
  - Channel status timing measures the RPC on both success and failure. Chat never resends a message as a side effect of these changes.
docs:
  required: true
---

The Windows incident showed consecutive 30-second config reads while chat and heartbeat requests failed. The time reported for a failed channel probe also included work before the RPC. These changes limit that additional delay and improve attribution on the next occurrence. The cause of the original Gateway stall remains open.

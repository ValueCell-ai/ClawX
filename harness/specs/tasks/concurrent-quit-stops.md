---
id: concurrent-quit-stops
title: Stop Gateway and Computer Use concurrently on quit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Start both existing stop operations without waiting for Gateway shutdown first.
touchedAreas:
  - electron/main/index.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - harness/specs/tasks/concurrent-quit-stops.md
  - harness/specs/tasks/local-computer-use.md
  - harness/specs/rules/local-computer-use.md
  - harness/reference/computer-use.md
expectedUserBehavior:
  - Orderly quit begins Computer Use cleanup even while Gateway shutdown remains pending.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/main-quit-lifecycle.test.ts
acceptance:
  - Both stops begin concurrently and each failure is logged independently, including synchronous throws.
  - E2E mode still stops Gateway but skips Computer Use cleanup.
  - Quit waits for both stops or the existing five-second deadline; emergency Gateway exit and timeout termination behavior remain unchanged.
  - No new force-kill mechanism, lifecycle queue changes, or ASAR changes.
docs:
  required: false
  reason: Internal shutdown scheduling only; README opt-in and permission flows are unchanged. Lifecycle rule and reference are updated.
---

# Concurrent Quit Stops

Exercise the actual before-quit callback from source with deferred stop promises
and fake timers, without importing startup side effects or adding a runtime API.

---
id: concurrent-quit-stops
title: Stop ACP and Gateway alongside Computer Use on quit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop ACP before Gateway while Computer Use cleanup starts independently, retaining the shared quit deadline.
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
  - ACP and Computer Use stops begin concurrently; Gateway stop follows ACP settlement so the ACP child cannot reconnect during Gateway shutdown.
  - Each stop failure is logged independently, including synchronous throws, and an ACP stop failure does not skip Gateway stop.
  - E2E mode still stops Gateway but skips Computer Use cleanup.
  - Quit waits for ACP, Gateway and Computer Use stops or the existing five-second deadline, including an unresolved ACP stop; emergency Gateway exit and timeout termination behavior remain unchanged.
  - No new force-kill mechanism, lifecycle queue changes, or ASAR changes.
docs:
  required: false
  reason: Internal shutdown scheduling only; README opt-in and permission flows are unchanged. Lifecycle rule and reference are updated.
---

# Concurrent Quit Stops

Exercise the actual before-quit callback from source with deferred stop promises
and fake timers, without importing startup side effects or adding a runtime API.

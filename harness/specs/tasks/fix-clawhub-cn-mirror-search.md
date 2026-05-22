---
id: fix-clawhub-cn-mirror-search
title: Keep ClawHub marketplace search usable when cached mirror APIs fail
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Fix issue #960 so Skills marketplace search and explore do not fail when the ClawHub CLI is pointed at a static mirror or stale registry cache.
touchedAreas:
  - electron/gateway/clawhub.ts
  - tests/unit/clawhub-service.test.ts
  - harness/specs/tasks/fix-clawhub-cn-mirror-search.md
expectedUserBehavior:
  - Opening Skills Explore returns marketplace entries when the official ClawHub JSON API is reachable.
  - Searching skills returns marketplace entries without depending on a cached static mirror registry.
  - If the official JSON API is unavailable or returns non-JSON, ClawX falls back to the existing ClawHub CLI behavior.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/clawhub-service.test.ts
acceptance:
  - Search uses the official ClawHub JSON API before invoking the CLI fallback.
  - Explore uses the official ClawHub JSON API before invoking the CLI fallback.
  - Non-JSON or failed HTTP responses do not break the existing CLI fallback path.
docs:
  required: false
---

Use this task spec when changing ClawHub marketplace lookup behavior in the main process.

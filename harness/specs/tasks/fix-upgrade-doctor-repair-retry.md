---
id: fix-upgrade-doctor-repair-retry
title: Finish the 0.6.1 upgrade repair on slow Windows machines
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: On a 0.6.1 in-place upgrade on a slow Windows laptop with four channel plugins, ClawX spent 60 s on a `config validate` before capability consent, killed the startup Doctor repair at 10 minutes during its final cleanup, and treated a later Doctor run that exited 1 (broken plugins after a successful migration) as fatal. The Gateway stayed down until a manual restart. Let the Gateway, not Doctor's exit status, decide whether state is usable, allow a second repair when the Gateway reports progress, give Doctor enough time, and keep consent off the first upgraded launch.
touchedAreas:
  - electron/gateway/startup-orchestrator.ts
  - electron/gateway/startup-recovery.ts
  - electron/gateway/supervisor.ts
  - electron/gateway/manager.ts
  - electron/utils/openclaw-doctor.ts
  - electron/utils/openclaw-command.ts
  - electron/utils/plugin-capability-consent.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/openclaw-command-validate.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/rules/openclaw-runtime-child-processes.md
  - harness/specs/tasks/fix-upgrade-doctor-repair-retry.md
expectedUserBehavior:
  - A 0.6.1 → 2026.10.5 in-place upgrade on Windows reaches a running Gateway without the user deleting channels or restarting it.
  - The first upgraded launch starts the Gateway without waiting on capability consent or `config validate`.
  - A Gateway whose state cannot be migrated still fails clearly instead of looping Doctor runs.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
acceptance:
  - After a startup Doctor run that exits non-zero or times out, the orchestrator relaunches the Gateway once instead of failing.
  - A second Doctor run happens only when the Gateway refuses for a different reason than before the previous run, and never more than twice per startup.
  - The startup and Settings Doctor repairs time out after 30 minutes, an exit after the timeout is not logged as success, and Doctor stdout is logged at info level.
  - Capability consent is deferred without caching until the managed Gateway has connected on the current OpenClaw version, and runs no `config validate`.
docs:
  required: true
---

See `harness/reference/openclaw-2026-10-5-upgrade.md` (Doctor exit status and
repeated repairs; Capability consent for ClawX mirrors) for the 2026-10-28
field timeline.

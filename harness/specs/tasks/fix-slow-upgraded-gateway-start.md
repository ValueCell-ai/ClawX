---
id: fix-slow-upgraded-gateway-start
title: Let a slow upgraded Gateway finish starting instead of killing it and running Doctor
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: On a slow Windows laptop after a 0.6.1 overwrite upgrade, the Gateway needed more than 120 s to become ready (85 s on its one successful start, mostly plugin loading that blocks the event loop). ClawX killed it at a fixed 120 s readiness deadline, read the Windows forced-exit code 1 as a config failure, and ran a 12-minute Doctor repair before each retry. Capability consent also held the Gateway start for 210 s while its CLI lingered after finishing. Follow the Gateway's output for the readiness deadline, never run Doctor for a readiness timeout, and stop the consent CLI once it has reported every id.
touchedAreas:
  - electron/gateway/ws-client.ts
  - electron/gateway/manager.ts
  - electron/gateway/startup-recovery.ts
  - electron/utils/openclaw-command.ts
  - electron/utils/plugin-capability-consent.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/tasks/fix-slow-upgraded-gateway-start.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A Gateway that keeps making progress reaches a running state even when its cold start takes several minutes.
  - A Gateway that misses its readiness deadline fails with an error, without a Doctor repair first.
  - Capability consent adds at most a few seconds after the CLI reports every plugin as enabled.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/plugin-capability-consent.test.ts
acceptance:
  - A managed cold start fails readiness only after 180 s without Gateway output, or after 10 minutes in total; the error states how long the Gateway was silent.
  - The startup recovery returns `fail`, not `repair`, for a readiness timeout with exit code 1, unless stderr carries an explicit config failure.
  - '`runOpenClawCommand` stops a command whose `completeWhen` output appeared but which has not exited 5 s later, and reports it as successful with `completedByOutput`.'
  - Capability consent completes once every pending id printed `Enabled plugin "<id>".`
docs:
  required: true
---

See `harness/reference/openclaw-2026-10-5-upgrade.md` (Slow upgraded starts and
the readiness deadline; Capability consent for ClawX mirrors) for the
2026-10-29 field timeline.

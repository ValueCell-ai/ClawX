---
id: fix-windows-gateway-restart-latency
title: Fix Windows Gateway shutdown and repeated startup checks
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply the measured stale-owner fast path, remove the empty Windows broker shutdown delay, use an owned-process graceful stop contract, and honor persisted webhook migration completion without weakening ownership or configuration migration guards.
touchedAreas:
  - .gitattributes
  - electron/gateway/**
  - electron/utils/openclaw-utility-process.ts
  - electron/main/index.ts
  - electron/main/quit-lifecycle.ts
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig.node.json
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - harness/specs/tasks/fix-windows-gateway-restart-latency.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/reference/windows-gateway-restart-latency.md
  - harness/reference/local-061-upgrade-validation.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Restart stops the owned Gateway through its actual shutdown handler before replacing it, with bounded fallback for an unresponsive process.
  - Startup does not repeatedly launch Windows utilities to inspect a process already confirmed dead.
  - Completed webhook compatibility work is not repeated; actual channel migrations and concurrent-config protection remain intact.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - channel-plugin-migration-guards
  - docs-sync
requiredTests:
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
acceptance:
  - Confirmed dead owners skip start-time lookup; live or unknown owners retain PID reuse detection and the final death check.
  - The private shutdown request applies only to the owned Gateway child, never arbitrary child commands or an external PID; early startup and unavailable handlers retain bounded cleanup.
  - An empty Windows spawn broker skips only the unsupported Unix process-group census and its advisory delay; tracked processes, pending starts, native resources and Unix uncertainty retain their existing cleanup.
  - Config and machine migration markers are combined consistently, preserving explicit config values, true completion, partial migrations and config rollback guards.
  - Real packaged-runtime starts and repeated in-app restarts preserve fixture history and verify exit/ownership cleanup, readiness and timings without profiling hooks.
  - Keep focused regression coverage in existing suites and remove superseded temporary probes rather than deleting useful tests to obtain a pass.
docs:
  required: true
references:
  - harness/reference/windows-gateway-restart-latency.md
  - harness/reference/local-061-upgrade-validation.md
---

The isolated diagnosis measured 69 PowerShell plus 69 WMIC probes of the already
exited previous Gateway, consuming 22 seconds. An early definitive-death check
reduced standard-PowerShell-PATH startup from 51.380 to 28.027 seconds. The
unsupported shutdown RPC and incomplete webhook completion marker remain
separate defects addressed by this task. Keep their timing effects distinct.

Implementation and packaged validation are recorded in the linked reference.
The additional measured Windows empty-broker delay is fixed. The final full
sequence passes clean exits, ownership release and history preservation; its
first restart still reports three SQLite checkpoint busy waits with an unknown
blocking reader. Checkpoint semantics were not weakened. Twenty-six temporary
files were removed; automatic approval review blocked deletion of the separate
eight-file SQLite experiment directory, which remains with its cleanup record.

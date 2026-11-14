---
id: fix-gateway-undefined-launch-env
title: Start the Gateway when optional migration environment values are absent
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix the Electron utility-process env conversion failure reproduced from the enterprise Windows upgrade report when no cron inference migration manifest is produced.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/gateway/config-sync-env.ts
  - electron/utils/openclaw-utility-process.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/e2e/gateway-launch-env.spec.ts
  - harness/specs/tasks/fix-gateway-undefined-launch-env.md
  - harness/specs/rules/openclaw-runtime-child-processes.md
  - harness/reference/gateway-undefined-launch-env-20261111.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Upgraded and fresh profiles with no cron migration manifest can launch their managed Gateway without an Invalid value for env retry loop.
  - Profiles with a manifest still pass its exact path to the runtime.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-runtime-child-processes
  - docs-sync
requiredTests:
  - tests/unit/config-sync.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/e2e/gateway-launch-env.spec.ts
acceptance:
  - The Gateway launch environment omits CLAWX_CRON_MIGRATION_MANIFEST at construction when no manifest exists, including when the parent has a stale value; only a current nonempty manifest path is injected.
  - The shared utility-process boundary removes undefined environment entries without stringifying them, mutating the caller, or restoring explicitly unset inherited values.
  - Preserve empty proxy overrides, all defined string values, migration manifest paths, debug and private Gateway control behavior.
  - A real isolated Electron utility process starts and exits successfully with absent and present migration manifests; the absent case fails before the fix.
  - Do not run the customer's profile, change databases, remove plugins, or mask unrelated plugin dependency failures.
docs:
  required: true
references:
  - harness/reference/gateway-undefined-launch-env-20261111.md
---

The report records `Invalid value for env` in `ForkUtilityProcess` before a
Gateway PID exists, followed by ten unsuccessful automatic retries. The failing
launch builder set `CLAWX_CRON_MIGRATION_MANIFEST` to an optional value.
Node child-process environment types admit `undefined`; Electron's native
environment conversion does not. Cover the actual Electron boundary as well
as unit-level option preservation.

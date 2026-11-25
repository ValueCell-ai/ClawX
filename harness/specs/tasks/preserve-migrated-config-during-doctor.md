---
id: preserve-migrated-config-during-doctor
title: Preserve a verified legacy config migration during Doctor recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep a valid migrated enterprise configuration when a known prelaunch migration crosses the suspicious-size threshold, and retain native recovery for damaged or unrecognized configurations.
touchedAreas:
  - electron/gateway/config-delivery.ts
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-proxy.ts
  - electron/utils/config-migration-receipt.ts
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-migrated-config-recovery.test.ts
  - tests/unit/config-migration-receipt.test.ts
  - harness/specs/rules/channel-plugin-migration-guards.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/specs/tasks/preserve-migrated-config-during-doctor.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - openclaw-upgrade-persistence
  - channel-plugin-migration-guards
  - docs-sync
expectedUserBehavior:
  - A 0.6.1 overwrite retains both configured channel accounts through Doctor, restart and reopen.
  - Doctor can still recover a genuinely damaged config.
requiredTests:
  - tests/unit/config-migration-receipt.test.ts
  - tests/unit/openclaw-migrated-config-recovery.test.ts
  - tests/unit/gateway-config-delivery.test.ts
acceptance:
  - Reject stale evidence, paths for a different config and unrecognized changes. Preserve the native validation and recovery checks.
  - Preserve independently configured model aliases alongside enterprise models, including when startup synchronizes a Telegram proxy before migrating the config.
  - Build the enterprise Windows installer and test 0.6.1 with stock and historical channel keys, and 0.7.1 with stock keys.
  - Check channel accounts, model selections and fallbacks, scheduled jobs and their execution history, and time three actual Settings restarts per configuration.
docs:
  required: true
---

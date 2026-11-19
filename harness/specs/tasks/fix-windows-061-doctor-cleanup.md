---
id: fix-windows-061-doctor-cleanup
title: Complete offline Doctor cleanup during the Windows 0.6.1 upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Repair the desktop startup path that fails to retire temporary SQLite snapshots during an upgrade from the official Windows 0.6.1 runtime.
touchedAreas:
  - electron/gateway/supervisor.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/openclaw-command.ts
  - tests/unit/gateway-supervisor.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/fix-windows-061-doctor-cleanup.md
  - harness/specs/rules/openclaw-runtime-child-processes.md
expectedUserBehavior:
  - Desktop startup completes offline migration and starts the Gateway automatically.
  - Existing jobs keep their identity, schedule, model, account and delivery settings and an enabled job runs at its scheduled time.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-runtime-child-processes
  - openclaw-upgrade-persistence
requiredTests:
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-snapshot-admission-cleanup.test.ts
  - tests/unit/gateway-supervisor.test.ts
acceptance:
  - Exercise the failing cleanup through the real Windows runtime.
  - Upgrade fresh state generated with the official 0.6.1 runtime through the production Electron Gateway manager, including its own Doctor, and verify old run history and scheduled execution against a loopback provider.
  - Preserve SQLite integrity checks, private staging, junction handling and error propagation.
docs:
  required: true
---

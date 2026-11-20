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
  - tests/e2e/agent-creation-upgrade.spec.ts
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
  - The upgraded app preserves old session history, workspace, settings and model selection and accepts a new chat message in the same session.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-runtime-child-processes
  - openclaw-upgrade-persistence
requiredTests:
  - tests/e2e/agent-creation-upgrade.spec.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-snapshot-admission-cleanup.test.ts
  - tests/unit/gateway-supervisor.test.ts
acceptance:
  - Observe the complete cleanup output and the expected exit code from the Electron utility process for both migration refusal and Doctor success.
  - Exercise the failing cleanup through the real Windows runtime.
  - Upgrade state generated with the official 0.6.1 runtime through the Windows Electron Gateway manager, including its own Doctor, then read the old conversation and send an ACP prompt to the same session with a loopback provider.
  - Preserve SQLite integrity checks, private staging, junction handling and error propagation.
docs:
  required: true
---

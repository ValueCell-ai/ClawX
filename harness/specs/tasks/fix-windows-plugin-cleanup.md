---
id: fix-windows-plugin-cleanup
title: Fix Windows channel plugin cleanup
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Remove unconfigured channel plugins safely when their Windows paths use the namespaced path prefix.
touchedAreas:
  - .github/workflows/check.yml
  - electron/gateway/config-sync.ts
  - electron/utils/plugin-install.ts
  - electron/utils/safe-fs.ts
  - tests/unit/safe-fs.test.ts
  - harness/specs/tasks/fix-windows-plugin-cleanup.md
expectedUserBehavior:
  - Removing a configured channel also removes its stale plugin directory on Windows.
  - Plugin cleanup never follows outbound directory links into the bundled OpenClaw runtime.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/safe-fs.test.ts
acceptance:
  - Safe recursive removal accepts Windows namespaced paths such as `\\?\C:\Users\...\extensions\wecom`.
  - Real-path validation does not reduce a namespaced drive path to `C:`.
  - Outbound symlink and junction targets remain untouched.
references:
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
docs:
  required: false
---

This task covers the Windows cleanup path used during Gateway configuration
synchronization after a channel is removed. The deletion guard must retain its
junction-safety checks while resolving namespaced paths through the native
Windows real-path implementation.

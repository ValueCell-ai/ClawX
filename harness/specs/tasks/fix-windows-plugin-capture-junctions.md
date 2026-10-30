---
id: fix-windows-plugin-capture-junctions
title: Keep OpenClaw plugin capture recovery copies loadable on Windows
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Stop OpenClaw 2026.10.5 from failing every Windows plugin capture recovery copy with `EPERM`, which made the upgrade-time Doctor repair reload ClawX channel plugins for many minutes and left the Gateway down after a 0.6.1 in-place upgrade.
touchedAreas:
  - patches/openclaw@2026.10.5.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-windows-recovery-junction-patch.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/fix-windows-plugin-capture-junctions.md
expectedUserBehavior:
  - On Windows, a 0.6.1 → 2026.10.5 in-place upgrade's automatic Doctor repair loads the Feishu and QQ Bot doctor contracts without `EPERM: operation not permitted, symlink` and returns to Gateway startup.
  - Plugins with nested `node_modules` dependencies load from OpenClaw capture recovery copies on Windows for standard users without Developer Mode.
  - macOS and Linux plugin capture behavior is unchanged.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-windows-recovery-junction-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
acceptance:
  - On win32, `copyRecoverySource` recreates captured directory links, including dangling ones, as junctions. Targets inside the copied build are relocated into the recovery build, and other targets are kept.
  - File links and native references keep the existing `fs.cpSync` and hardlink handling, and non-Windows platforms take the unchanged path.
  - The pnpm patch hash in `pnpm-lock.yaml` matches `patches/openclaw@2026.10.5.patch`, and every patched chunk passes `node --check`.
  - A macOS Doctor run with simulated Windows link semantics reports no `EPERM`, no Feishu contract load failures, and no cross-build links.
docs:
  required: true
---

The Windows failure comes from Node's `fs.cpSync`, which recreates junctions
as untyped symlinks. Standard users cannot create those, and the copies keep
absolute targets into the source capture. OpenClaw issue #163139 tracks the
same failure upstream. See `harness/reference/openclaw-2026-10-5-upgrade.md`
for the Windows evidence and the simulated reproduction.

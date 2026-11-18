---
id: fix-macos-signing-emfile
title: Bound macOS signing scans to prevent file descriptor exhaustion
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Fix the 0.7.0 macOS release signing failure caused by unbounded recursive file probes in the pinned osx-sign dependency.
touchedAreas:
  - patches/@electron__osx-sign@1.3.3.patch
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - tests/unit/macos-signing-walk.test.ts
  - harness/specs/tasks/fix-macos-signing-emfile.md
  - harness/specs/rules/macos-signing-resource-bounds.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/reference/macos-signing-emfile.md
expectedUserBehavior:
  - Large macOS application bundles reach code signing without exhausting open file descriptors during discovery.
  - Native binaries and nested application/framework bundles remain eligible for signing.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/macos-signing-walk.test.ts
acceptance:
  - Reproduce EMFILE with the original pinned signer under a low file descriptor limit, then exercise the patched signer against the same fixture.
  - Bound traversal across the entire recursive walk, not independently for each directory.
  - Preserve binary detection, nested bundle traversal/order, temporary signature cleanup, and error propagation.
  - Cover both published CommonJS and ESM implementations and verify the patch is selected by the frozen lockfile.
  - Keep signing identity, entitlements, hardened runtime and notarization enabled in release configuration.
  - Distinguish local scan/ad-hoc signing checks from Developer ID signing and notarization in CI.
docs:
  required: false
---

Build-time dependency fix only: no application, channel, Gateway protocol, or UI
changes. Review the three README files; keep diagnosis and validation boundaries
in `harness/reference/macos-signing-emfile.md`. Remove temporary fixtures and logs.

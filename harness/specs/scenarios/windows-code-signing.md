---
id: windows-code-signing
title: Windows release code signing
type: release-tooling
ownedPaths:
  - scripts/windows-signing.cjs
  - scripts/windows-builder-config.cjs
  - scripts/setup-windows-signing.ps1
  - scripts/run-electron-builder.mjs
  - .github/workflows/release.yml
  - .github/workflows/win-build-test.yml
  - .github/workflows/package-win-manual.yml
  - tests/unit/windows-signing.test.ts
  - tests/unit/windows-signing-workflows.test.ts
requiredProfiles:
  - fast
requiredRules:
  - windows-signing-release-policy
  - docs-sync
references:
  - harness/reference/windows-code-signing.md
---

ClawX and ClawX Biz share the community edition's build-time Windows signing
implementation. Release, preview and manual distributable builds use SSL.com
OV and eSigner. Unsigned local development builds remain possible without
signing credentials. The enterprise release must select an upstream ref that
contains the shared signing implementation.

Validate configuration selection, signing failures, credential secrecy,
publisher identity, timestamp verification and upstream helper preservation.
Offline checks do not establish CA issuance, paid cloud signing, SmartScreen
reputation or successful installation and update on a clean Windows machine.

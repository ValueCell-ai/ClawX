---
id: unify-windows-esigner
title: Unify ClawX and ClawX Biz Windows signing with eSigner
scenario: windows-code-signing
taskType: release-tooling
intent: Replace SignPath post-processing with one build-time SSL.com OV and eSigner integration reusable by community and enterprise Windows releases.
touchedAreas:
  - scripts/windows-signing.cjs
  - scripts/windows-builder-config.cjs
  - scripts/setup-windows-signing.ps1
  - scripts/run-electron-builder.mjs
  - electron-builder.yml
  - .github/workflows/release.yml
  - .github/workflows/win-build-test.yml
  - .github/workflows/package-win-manual.yml
  - tests/unit/windows-signing.test.ts
  - tests/unit/windows-signing-workflows.test.ts
  - harness/specs/scenarios/windows-code-signing.md
  - harness/specs/rules/windows-signing-release-policy.md
  - harness/specs/tasks/unify-windows-esigner.md
  - harness/reference/windows-code-signing.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Public Windows releases carry the verified company publisher signature.
  - Community and enterprise editions use the same signing implementation.
  - Local unsigned development builds do not require cloud credentials.
requiredProfiles:
  - fast
requiredRules:
  - windows-signing-release-policy
  - docs-sync
requiredTests:
  - tests/unit/windows-signing.test.ts
  - tests/unit/windows-signing-workflows.test.ts
acceptance:
  - All Windows distribution workflows select the same build-time signing policy, with no SignPath calls or post-sign manifest repair.
  - Missing credentials, a failed signer, a wrong publisher, an invalid signature or missing timestamp stops signing.
  - Signed builds enable updater signature verification and publish metadata produced after signing.
  - Existing valid signatures on explicitly allowed helper executables are preserved, while application and installer publishers are verified.
  - Documentation walks a Hong Kong company through application materials, OV issuance, eSigner automation, repository setup, trial release, renewal and troubleshooting.
  - Offline tests and schema checks report their limits; production issuance and paid signing require the user's service account.
docs:
  required: true
references:
  - harness/reference/windows-code-signing.md
---

Implement and validate in isolated worktrees based on each repository's main.
The enterprise workflow change lives in ClawX-biz and selects an upstream ref
containing this shared integration. It must not duplicate the signing code or
silently use an older unsigned baseline. No runtime communication path changes.

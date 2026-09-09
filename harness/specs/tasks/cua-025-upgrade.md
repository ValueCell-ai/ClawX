---
id: cua-025-upgrade
title: Upgrade bundled CUA to 0.25.0
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade the CUA SDK, native driver and computer-use Skill together to 0.25.0, restoring supported daemon telemetry suppression and preserving the Windows PE console fix.
touchedAreas:
  - electron/**
  - resources/**
  - scripts/**
  - tests/**
  - harness/**
  - shared/**
  - src/**
  - .github/workflows/check.yml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - electron-builder.yml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Computer Use retains its opt-in, permission UI and /computer-use name while using bundled native CUA 0.25.0.
  - Both the embedded daemon and Gateway-launched CLI disable CUA product telemetry without changing persistent or system settings.
  - The official Skill accompanying the pinned 0.25.0 release is bundled offline and untouched prior ClawX Skill installations receive the new guidance.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cua-runtime.test.ts
  - tests/unit/cua-driver-artifacts.test.ts
  - tests/unit/cua-sdk.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/e2e/computer-use.spec.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - Pin @trycua/cua-driver and its native dependencies to the published 0.25.0 release and match the shipped CLI version.
  - Verify macOS universal and Windows x64 archive SHA256 values before extraction and preserve Windows PE subsystem console-to-GUI rewriting.
  - Real native SDK construction accepts manager-produced telemetry-disabled options without starting the daemon or requesting OS grants.
  - Keep CUA_DRIVER_RS_TELEMETRY_ENABLED false in Gateway CLI children and add the now-allowlisted override to embedded daemon options.
  - Keep physical ASAR-unpacked native SDK loading and validate the upgraded export/library layout.
  - Vendor the 0.25.0 official Skill snapshot and MIT license with exact source hashes while retaining computer-use as the only active Skill entrypoint.
  - Update ClawX-specific CLI guidance against the new command/session/screenshot contract, not a blind version-string replacement.
  - Upgrade untouched known 0.21.0 bundled Skill files safely without overwriting user modifications or leaving old version requirements active.
  - Preserve Main-owned lifecycle, local-only CLI calls, no model-controlled permission grants, and no uncertain input replay.
  - Update four locales and three READMEs; report Windows native and rebuilt-package verification separately from synthetic tests.
docs:
  required: true
---

# CUA 0.25.0 Upgrade

Use tag `cua-driver-rs-v0.25.0`, commit
`45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f`, for driver and official Skill provenance.
The embedded telemetry allowlist fix shipped in 0.22.0 and remains in 0.25.0.
Keep the existing Gateway environment override and PE patch; upgrade the SDK
before restoring daemon overrides so native validation cannot repeat the 0.21.0
Configuration failure.

Implementation units: SDK/artifacts/runtime; official Skill and narrowly scoped
installed-bundle upgrades; product/reference docs and validation. These can be
worked independently with disjoint file ownership. Only this task is the current
upgrade contract; earlier version-specific validation remains historical.

No upstream moving-main fetch, runtime dependency downloads, new action wrapper,
MCP integration, platform expansion, or global/persisted telemetry mutation.

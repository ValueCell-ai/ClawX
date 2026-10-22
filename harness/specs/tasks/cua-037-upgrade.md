---
id: cua-037-upgrade
title: Upgrade CUA to 0.37.0 and improve local lifecycle recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade the paired SDK, native driver and offline Skill, use SDK readiness and cancellation, and keep local Computer Use startup and recovery responsive.
touchedAreas:
  - electron/**
  - src/**
  - shared/**
  - resources/**
  - scripts/**
  - .github/workflows/**
  - tests/**
  - harness/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Computer Use remains opt-in and uses the paired 0.37.0 SDK, native CLI and official guidance.
  - Optional CUA initialization does not delay Gateway startup; status reads remain available during lifecycle operations.
  - Users can retry an unavailable enabled driver without toggling the preference or requesting permissions again.
  - Shutdown cancels native startup and never publishes a cancelled generation; disabled startup stays unprivileged.
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
  - tests/unit/computer-use-api.test.ts
  - tests/unit/cua-sdk.test.ts
  - tests/unit/cua-driver-artifacts.test.ts
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/e2e/computer-use.spec.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - Pin SDK, platform packages, macOS universal and Windows x64 binaries and official Skill to 0.37.0 with release provenance and SHA256 checks; do not mix the unpublished 0.38.0 npm SDK with a newer driver.
  - Retain Main-owned direct child lifecycle, physical ASAR imports, telemetry suppression, Windows PE patch, explicit CLI endpoints and existing exec/read transport.
  - Rely on the SDK metadata handshake and bounded startup/shutdown options instead of an additional raw socket probe; cancellation prevents descriptor publication and releases the host.
  - Status exposes starting/stopping and actionable unavailable reasons without joining the lifecycle queue; explicit retry reconciles both supported platforms without implicit permission prompts.
  - Initialize CUA independently from Gateway and preserve disabled startup, failed-opt-in rollback, quit ordering and the existing application quit deadline.
  - Update the ClawX Skill for the new upstream document layout and bounded run_steps/run_script workflows without blind input replay, global policy changes or permission-dialog automation.
  - Cover management changes with Electron E2E and all four locales; run communication replay/compare, harness checks, typecheck, lint, unit and packaged-native import checks.
  - Release workflows use the frozen lockfile, run packaged CUA native-import smoke checks on macOS and Windows, and fail when a platform upload has no release artifacts.
  - Record actual native and package checks separately from mocks; do not claim Windows execution, signed attribution or model task success without respective evidence.
docs:
  required: true
---

# CUA 0.37.0 upgrade

Supersedes the current version pin in `cua-025-upgrade.md`. Preserve its historical
validation records. See `harness/reference/computer-use.md` and
`harness/reference/computer-use-cli-validation.md` for ownership and evidence.

The 0.25.0 SDK already includes metadata readiness, startup/shutdown bounds and
startup cancellation. Use those contracts in ClawX instead of treating the
uncommitted extra socket probe as a proven native race fix.

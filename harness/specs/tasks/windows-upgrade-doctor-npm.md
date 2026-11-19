---
id: windows-upgrade-doctor-npm
title: Restore Windows Gateway upgrades with a legacy image model and no system npm
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Migrate the legacy image model setting and let Doctor finish its package checks during Windows agent database upgrades.
touchedAreas:
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-media-models.ts
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-windows-doctor-npm.test.ts
  - tests/unit/openclaw-auth.test.ts
  - harness/specs/tasks/windows-upgrade-doctor-npm.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Automatic startup repair and manual Doctor can invoke the packaged npm during a Windows upgrade.
  - The legacy image model setting is migrated before Doctor validates the configuration, keeping the selected model and its options.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/openclaw-windows-doctor-npm.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - Exercise the real npm CLI with an empty search path and preserve arguments and the exit status.
  - Retain OpenClaw's normal backup, migration, and admission checks.
  - Preserve existing canonical image settings and sibling media settings during the prelaunch rename.
docs:
  required: true
---

The 0.6.2 to 0.7.0 report shows Doctor completing shared-state migrations
before it exits with `spawn npm.cmd ENOENT`. The following Gateway launch
still requires the main agent's schema v1 media migration.

In an isolated profile with a legacy image model and a DeepSeek chat model,
Doctor's plugin check invokes `npm view @openclaw/deepseek-provider@2026.10.10`
to read registry metadata. A missing executable aborts that check before the
media migration. The Windows resolver can use the npm dependency already
shipped with OpenClaw for this call.

OpenClaw's schema validator rejected the redacted report configuration at
`agents.defaults.imageGenerationModel`. Moving its complete value to
`agents.defaults.mediaModels.image` resolved the validation error.

An isolated macOS run used the 0.6.2 four-table auth schema, a synthetic
credential and the pinned DeepSeek package from an npm cache. Doctor migrated
the agent database from v1 to v27 and retained the credential. With the image
field migrated, Doctor exited successfully and Gateway returned HTTP 200 with
`ready: true` from `/readyz`. The Windows resolver is covered separately by
`openclaw-windows-doctor-npm.test.ts`.

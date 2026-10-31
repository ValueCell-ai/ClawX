---
id: isolate-legacy-development-runtime
title: Isolate legacy OpenClaw development data
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Run the pre-upgrade UI branch against an isolated legacy profile while preserving migrated OpenClaw state and the migration branch.
touchedAreas:
  - src/App.tsx
  - electron/**
  - scripts/**
  - shared/**
  - tests/**
  - harness/**
  - package.json
  - pnpm-workspace.yaml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - pnpm dev keeps its default behavior; pnpm dev:legacy uses dedicated app, config, state, workspace and port locations.
  - Initial preparation backs up migrated state and imports compatible pre-migration configuration and static credentials into the isolated profile without overwriting either source.
  - Legacy sessions and queued work start fresh; channels, cron and computer operation do not start automatically from imported state.
  - The legacy entry refuses missing, unsafe or version-incompatible profile paths and never falls back to the shared state directory.
  - Gateway and ACP inherit the same isolated paths and ports, and the profile does not unload or adopt the default Gateway service.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - development-runtime-isolation
  - renderer-main-boundary
  - backend-communication-boundary
  - session-workspace-authority
  - docs-sync
requiredTests:
  - tests/unit/development-profile.test.ts
  - tests/unit/legacy-profile-setup.test.ts
  - tests/e2e/development-profile.spec.ts
acceptance:
  - Migrated config, auth and databases remain unchanged after preparing and launching legacy.
  - No HOME override, migration guard bypass, snapshot overwrite or shared-state downgrade is used.
  - Repeated legacy starts reuse their existing profile and preserve its data.
  - Default behavior and existing E2E isolation remain compatible.
docs:
  required: true
---

See [Development runtime isolation](../../reference/development-runtime-isolation.md).

---
id: plugin-lifecycle-management
title: Plugin Lifecycle Management
type: plugin-lifecycle
ownedPaths:
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - electron/utils/plugin-install.ts
  - electron/gateway/skills-symlink-cleanup.ts
  - electron/api/routes/skills.ts
  - src/stores/skills.ts
  - resources/skills/**
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/harness-specs.test.ts
  - harness/src/cli.mjs
  - harness/src/rules.mjs
  - harness/src/specs.mjs
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/rules/**
  - harness/specs/tasks/**
requiredProfiles:
  - fast
conditionalProfiles:
  comms:
    when:
      - plugin activation changes Gateway startup or runtime message delivery
      - channel/provider plugin ownership changes OpenClaw runtime config
  e2e:
    when:
      - plugin status, install, recovery, or diagnostics behavior is visible in the UI
requiredRules:
  - channel-plugin-migration-guards
  - capability-owner-resolution
  - active-config-guards
---

Plugin lifecycle management covers bundled and external plugins as one system with different source types. The core model has two layers:

- `PluginPackage`: a discoverable, installable, upgradable, and recoverable package with identity, version, source, manifest, install location, and validation state.
- `PluginCapability`: an integration surface declared by a package, such as a channel, provider, skill, or runtime extension.

Lifecycle stages:

- Declare: plugin manifests describe package identity, source expectations, compatibility, and provided capabilities.
- Discover: ClawX scans bundled and external sources and produces a factual inventory. Discovery does not choose active owners.
- Resolve: ClawX chooses canonical package/capability owners, applies migration rules, and marks conflicts before config activation.
- Materialize: ClawX installs, upgrades, copies, links, or verifies the physical package selected by resolution.
- Validate: ClawX verifies package manifests, dependencies, capability config, ownership uniqueness, and startup requirements.
- Activate: only resolved and validated capabilities enter final OpenClaw runtime config.
- Recover: failed upgrades, stale registrations, conflicts, and removed channels converge to a single diagnosable state with rollback or cleanup paths.

First-stage priority is integration safety: single-owner capability resolution, active config guards, direct regression tests for migration cases, and explicit task specs for resolution, validation, and recovery work.

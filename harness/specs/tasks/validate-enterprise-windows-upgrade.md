---
id: validate-enterprise-windows-upgrade
title: Validate enterprise Windows upgrades from 0.6.1 and main
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Exercise real enterprise packaged Main and Gateway code against isolated old enterprise profiles, covering both official 0.6.1-biz and an enterprise assembly of community main, then upgrade to the current repaired community branch with enterprise extensions.
touchedAreas:
  - harness/specs/tasks/validate-enterprise-windows-upgrade.md
  - harness/reference/enterprise-windows-upgrade-validation-20261109.md
  - harness/specs/tasks/optimize-windows-doctor-upgrade.md
  - harness/reference/windows-doctor-performance-20261109.md
expectedUserBehavior:
  - Enterprise startup completes migration without disabling enterprise auth extensions, policies or host API contributions.
  - Enterprise session artifacts, model choices, old histories, new local-model replies, workspaces and configured supported channels survive upgrade and restart.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - Record both community and Biz revisions, actual submodule gitlink, package/runtime versions and artifact hashes. Do not confuse the Biz main branch with a community-main runtime baseline.
  - Use the downloaded 0.6.1-biz.1 package and an independently assembled community-main enterprise package to create separate retained profiles before target upgrade.
  - Use only validated isolated launchers, profiles and ports. Never operate the installed ClawX, its configuration or its Gateway. Keep source assembly in exported copies.
  - Per the user, skip real enterprise gateway authentication. Use explicitly labeled local synthetic enterprise endpoints where necessary to test encrypted-session retention and startup projection, without E2E runtime stubs.
  - Assert enterprise extension setup and host contribution registration on first upgraded launch, including old-schema migration ordering. A successful Gateway alone is insufficient.
  - Check enterprise model router projection and policy while running, encrypted session preservation after shutdown, SkillsHub integration, supported channel settings, old/new histories, workspace markers and offline database integrity.
  - Repeat startup and report unsupported channels, real authentication, external SkillsHub services, EWS delivery and installer overwrite according to actual coverage.
docs:
  required: true
references:
  - harness/reference/enterprise-windows-upgrade-validation-20261109.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
---

Community migration fixes were committed and pushed as 23778449 before this
enterprise extension of the verification matrix. The live ClawX is out of
scope. Enterprise assembly and fixtures stay under ignored task directories.
Doctor performance investigation remains a separate ongoing task.

---
id: fix-enterprise-runtime-migration-order
title: Restore extension runtime credentials after offline schema preparation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix the reproduced enterprise upgrade ordering failure by exposing a generic awaited runtime preparation boundary and letting enterprise session projections run after the recoverable snapshot and native schema migration, before managed Gateway readiness is published.
touchedAreas:
  - electron/gateway/**
  - electron/extensions/**
  - electron/main/index.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-auth-sqlite.ts
  - electron/utils/openclaw-persistence-runtime.ts
  - electron/utils/plugin-install-index.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-startup-preparation-orchestration.test.ts
  - tests/unit/gateway-startup-preparation.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/openclaw-auth-readiness.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/fix-enterprise-runtime-migration-order.md
  - harness/specs/tasks/validate-enterprise-windows-upgrade.md
  - harness/specs/tasks/optimize-windows-doctor-upgrade.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/reference/enterprise-windows-upgrade-validation-20261109.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
  - harness/reference/windows-doctor-performance-20261109.md
expectedUserBehavior:
  - An existing enterprise session restores its models, credentials and SkillsHub configuration on the first successful upgraded launch, without requiring another login or app restart.
  - Both primary and secondary agents preserve histories and can use the enterprise model after native migration.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/openclaw-auth-readiness.test.ts
  - tests/unit/gateway-startup-preparation-orchestration.test.ts
  - tests/unit/gateway-startup-preparation.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/main-quit-lifecycle.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - Keep enterprise-specific session behavior in ClawX-biz and expose only a generic stable lifecycle boundary in the community host.
  - Preserve the first-launch snapshot before extension runtime writes. Never relax native schema, ownership, file identity or admission checks to make an early write succeed.
  - Await required extension runtime projection before publishing managed Gateway readiness; do not use a best-effort asynchronous ready listener or block extension setup waiting for a Gateway that has not started.
  - Cover normal restart, migration recovery including a nonzero Doctor with successful schema work, rejected migration, cancellation, logout and teardown. Do not resurrect stale sessions or mutate an unrelated external Gateway.
  - Normal app quit fences session writes and queued starts, stops ACP and the managed Gateway, then awaits offline extension cleanup under the existing total timeout. Verify that derived enterprise credentials and SkillsHub configuration are removed while encrypted login state remains restorable.
  - Verify both original enterprise upgrade baselines and repeated startup using the validated isolated launcher and local synthetic enterprise services. Real enterprise authentication remains excluded per the user.
  - Record first-original-profile and restored-clone runs separately; restored native capture identities may trigger additional capture work even when logical state is equivalent.
docs:
  required: true
references:
  - harness/reference/enterprise-windows-upgrade-validation-20261109.md
  - harness/reference/windows-sqlite-upgrade-validation-20261109.md
---

Reproduced against community 23778449 plus Biz 642a185: official enterprise
0.6.1 upgrades its databases and can chat on both agents, but enterprise startup
attempts auth projection against schema 1, catches the migration-pending error,
and leaves SkillsHub projection absent after Doctor. The completed main route
reproduces the same early projection failure against schema 25. Its earlier
test-harness timeout during the large pre-upgrade snapshot is recorded separately
and is not evidence of an enterprise extension failure.

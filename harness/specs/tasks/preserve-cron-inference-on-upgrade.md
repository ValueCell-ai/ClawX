---
id: preserve-cron-inference-on-upgrade
title: Preserve scheduled-task accounts and model fallback across upgrades
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep existing community and enterprise scheduled tasks executable after migration and remote model catalog updates without recreating tasks or pinning retired models.
touchedAreas:
  - electron/**
  - resources/**
  - scripts/**
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/**
  - README*.md
  - harness/**
expectedUserBehavior:
  - Existing tasks with recoverable original accounts keep running after upgrade.
  - Task IDs, schedules, enabled state, messages, delivery, histories and model inheritance are preserved.
  - Identical credential synchronization preserves valid authorizations; replaced or revoked accounts are not silently reassigned.
  - Enterprise model updates refresh inherited defaults and fallbacks; unavailable explicit models fall back within the same authorized account.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - packaged-runtime-pruning-guards
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/openclaw-cron-migration.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/openclaw-cron-migration-manifest.test.ts
  - tests/unit/gateway-startup-preparation.test.ts
  - tests/unit/cron-inference-continuity.test.ts
  - tests/unit/harness-specs.test.ts
  - node scripts/test-cron-upgrade.mjs
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Restore legacy inference ownership from verified migration evidence using native authorization and persistence APIs before the scheduler starts.
  - Await native agent database startup preparation before inspecting sessions or capturing account authorizations.
  - Keep existing bindings and runtime authority; ambiguous or changed credentials produce diagnostics without guessed ownership.
  - Same-session enterprise quit and restore use encrypted continuity evidence; logout and account replacement invalidate that evidence.
  - Remote catalog changes retain model inheritance and never authorize another account. Exhausted candidates produce a truthful failure.
  - Explicitly disabled fallback and locked model selection remain authoritative; model availability cannot override account or model policy.
  - All mutation and execution probes use isolated synthetic state and local inference services.
  - Fresh package installation preserves every patched runtime addition through the native postinstall inventory cleanup; stale files are still removed and patched JavaScript stays syntactically valid.
docs:
  required: true
---

The old drink-water task succeeded before native migration, then failed because
it had no recorded inference account. Normal edits do not establish a binding.
Auth synchronization also discarded authorization lifetime metadata. Cover both
upgrade compatibility and continuing execution after enterprise model refresh.

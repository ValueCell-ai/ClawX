---
id: upgrade-openclaw-2026-7-1-2
title: Upgrade the bundled OpenClaw runtime to 2026.7.1-2
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply the OpenClaw 2026.7.1 correction releases without regressing ClawX channels, providers, models, ACP chat, or packaged runtime behavior.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - patches/openclaw@2026.7.1-2.patch
  - electron/gateway/config-sync.ts
  - electron/gateway/manager.ts
  - electron/utils/openclaw-upgrade-snapshot.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - harness/reference/openclaw-config-delivery.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1.md
  - harness/specs/tasks/upgrade-openclaw-2026-7-1-2.md
expectedUserBehavior:
  - A direct ClawX 0.5.1 upgrade from OpenClaw 2026.6.10 preserves configuration, authentication, sessions, ClawX-managed selected models, channel credentials, and managed channel plugin identities through the inherited 2026.7.1 migration.
  - Manual catalog-only model references require explicit upgrade preflight because the upstream unconfigured global model catalog is smaller in 2026.7.1 than in 2026.6.10; explicit ClawX-managed provider models are not dependent on that catalog entry remaining built in.
  - Existing configuration, authentication, sessions, models, and channel credentials remain usable after upgrading from OpenClaw 2026.7.1.
  - The supported ClawX channel catalog and effective plugin identities remain unchanged.
  - Official managed plugin updates tolerate repaired npm lock metadata and singleton-array npm view responses.
  - Codex turns continue to their authoritative terminal result after progress replies.
  - Legacy migration residue, Memory Core derived-sidecar conflicts, and guarded WSL EROFS permission results do not cause avoidable Gateway startup failures.
  - When canonical SQLite update-check state already exists, conflicting legacy update-check JSON is backed up outside the active state root before launch instead of causing a doctor retry loop.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
acceptance:
  - The OpenClaw runtime is pinned to 2026.7.1-2 and resolves @openclaw/ai 2026.7.1-2.
  - External channel plugin package versions and ClawX's supported channel catalog remain unchanged because the correction release does not change channel APIs or manifests.
  - Provider and model configuration behavior remains unchanged because the correction release does not change provider or model catalog sources.
  - The bundled-runtime patch and pruning pipeline succeeds against OpenClaw 2026.7.1-2.
  - Prelaunch preserves legacy update-check JSON for upstream import when SQLite has no canonical row, and quarantines it with restrictive permissions when SQLite is already authoritative.
  - The pre-migration snapshot is removed after either the native ready event or an equivalent successful RPC-router readiness fallback, so a missed early event does not leave duplicated auth/SQLite secrets behind.
  - Type checks, targeted channel/provider/ACP tests, communication regression checks, and harness validation pass.
docs:
  required: false
---

Use this task spec for the correction-release upgrade from OpenClaw 2026.7.1
to 2026.7.1-2. It inherits the runtime and migration compatibility work captured
in `upgrade-openclaw-2026-7-1.md` and focuses on proving that the correction
release does not widen ClawX's channel or model surface.

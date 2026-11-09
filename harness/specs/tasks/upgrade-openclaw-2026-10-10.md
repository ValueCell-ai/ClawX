---
id: upgrade-openclaw-2026-10-10
title: Preserve ClawX 0.6.1 profiles during the OpenClaw 2026.10.10 upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Upgrade the embedded runtime directly from official ClawX 0.6.1 profiles without an intermediate installation, preserving channel configuration, authentication, policy, tools, workspaces and history, with recoverable failures.
touchedAreas:
  - .github/workflows/check.yml
  - .github/workflows/electron-e2e.yml
  - package.json
  - electron-builder.yml
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - patches/**
  - scripts/**
  - electron/utils/**
  - electron/gateway/**
  - electron/services/**
  - resources/**
  - tests/unit/**
  - tests/e2e/**
  - tests/fixtures/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - AGENTS.md
expectedUserBehavior:
  - Official ClawX 0.6.1 with OpenClaw 2026.7.1-2 upgrades directly to 2026.10.10; no intermediate app or manual credential entry is required.
  - Telegram, Discord, QQ, DingTalk, WeCom and Weixin retain configured accounts, login state, routing, permissions and tools. Feishu preserves the starting-main migration behavior without additional capability or policy work.
  - WhatsApp's official dependency also moves to 2026.10.10; a separate WhatsApp login-flow redesign is outside this task.
  - Packages built from the starting main commit (6be7ae2c, OpenClaw 2026.10.5) upgrade in place independently of the official 0.6.1 baseline; fresh installs also work.
  - Select migration and recovery by actual runtime/data identity, not the ClawX app version alone. Never confuse a 10.5 upgrade snapshot with this upgrade's baseline.
  - Interrupted migration is retryable; a failed plugin replacement never advertises a new identity over old files, and rollback restores a coherent offline pre-upgrade state.
  - Workspaces, session history, auth inheritance and legacy default-Agent responsibilities retain their effective identity.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-upgrade-persistence
  - channel-plugin-migration-guards
  - plugin-mirror-compaction-guards
  - docs-sync
requiredTests:
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/prelaunch-maintenance-cache.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/openclaw-channel-runtime.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/qqbot-plugin-compat.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
acceptance:
  - Preserve Windows runtime and recovery compatibility. Per the updated task scope, do not add Windows-specific test cases or CI steps; retain existing main coverage and platform-independent migration, rollback and deferred utility exit regressions. Distinguish macOS validation from Windows installation acceptance.
  - Pin OpenClaw, Discord, WhatsApp and official Feishu to 2026.10.10, regenerate the runtime patch against that package, and preserve existing ACP/recovery/compaction behavior.
  - Use the upstream v27 schema contract for current Agent auth writes while preserving the narrowly verified historical v25 marker repair. Doctor owns actual schema migration.
  - Create a new WAL-consistent snapshot before any migration writer. Retain plugin payloads and applicable external persistence locations for offline recovery; never erase the baseline on readiness.
  - Keep Feishu migration behavior identical to starting main; its previously documented compatibility boundaries remain outside this task by explicit user direction.
  - Check published DingTalk, WeCom and Weixin host compatibility before choosing plugin version changes. Audit the sibling ClawX-biz SkillsHub integration for runtime/SDK assumptions and report any required enterprise adaptation.
  - Bind plugin installation records to the actual validated payload. Copy, validation, swap and metadata failures must leave a recoverable, internally consistent state.
  - Test both official 0.6.1-package and starting-main-package upgrades separately, including repeated startup, injected failures and offline rollback with isolated profiles and synthetic model credentials. Selected live channel accounts may be used only with explicit user authorization; message delivery requires a separately authorized destination. Never migrate the developer's real profile for validation.
  - Run focused regressions, typecheck, lint, frontend/runtime packaging, Electron upgrade E2E, harness validation/CI and communication replay/compare; report any platform or live-channel coverage not executed.
docs:
  required: true
references:
  - harness/reference/openclaw-2026-10-10-upgrade.md
  - harness/reference/local-061-upgrade-validation.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/reference/lark-openclaw-compatibility.md
---

The user explicitly kept Feishu at the starting-main migration behavior. A ready
Gateway or a discoverable plugin manifest alone does not prove channel
compatibility. Keep the official 0.6.1 baseline and the 10.5 baseline separate,
and validate retained configuration and actual plugin registration.

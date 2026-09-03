---
id: migrate-qqbot-allow-from
title: Migrate QQBot sender allowlists
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep ClawX QQBot saves compatible with the stable QQBot plugin schema and repair legacy ClawX configurations that omitted required sender allowlists.
touchedAreas:
  - harness/specs/tasks/migrate-qqbot-allow-from.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Saving QQBot credentials writes a valid `allowFrom` list for both the selected account and the mirrored default account configuration.
  - Existing QQBot configurations created by older ClawX versions gain missing `allowFrom` lists during startup sanitization without overwriting existing allowlists.
  - The stable `@openclaw/qqbot` 2026.7.1 package remains pinned because no 2026.8.2 package is published.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-config-delivery
  - backend-communication-boundary
  - channel-plugin-migration-guards
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
acceptance:
  - New QQBot saves default a missing account allowlist to `["*"]`, matching the stable plugin's own setup behavior.
  - Startup sanitization repairs missing top-level and per-account QQBot allowlists and preserves valid existing arrays.
  - Legacy scalar allowlist values are normalized to arrays instead of being discarded.
  - QQBot credentials and allowlist defaults are committed through the Main-owned config coordinator.
  - Focused unit tests, type checks, lint, and communication regression checks pass.
docs:
  required: true
---

This task references `gateway-backend-communication` because QQBot account
configuration crosses the typed Host API boundary and is validated by the
OpenClaw plugin runtime. The compatibility repair must occur before a legacy
configuration reaches the stricter plugin schema.

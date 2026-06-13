---
id: cc-connect-runtime-validation
title: Validate cc-connect runtime with real bundles and gated Codex OAuth
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make cc-connect runtime validation reproducible across mock bridge, real bundled binary startup, and opt-in real Codex OAuth chat.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/**
  - harness/specs/**
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - scripts/**
  - electron/main/**
  - electron/runtime/**
  - electron/services/**
  - electron/shared/**
  - electron/utils/**
  - shared/**
  - src/**
  - tests/e2e/**
  - tests/fixtures/**
  - tests/unit/**
expectedUserBehavior:
  - cc-connect can be selected and started from ClawX-managed runtime paths in local dev.
  - Mock bridge E2E continues to prove chat box delivery without external network or credentials.
  - Real bundled cc-connect and Codex binaries can start the runtime without mock replacement.
  - Real Codex OAuth chat can be verified only when a developer explicitly supplies an isolated logged-in CODEX_HOME.
  - Public provider profiles and committed test artifacts never contain OAuth token material.
  - Replacement readiness gaps are explicit, including missing in-app Codex OAuth lifecycle controls, chat abort parity, doctor/fix parity, operation-level capabilities, packaged app smoke, and real Management API coverage.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - capability-owner-resolution
  - active-config-guards
  - cc-connect-runtime-validation
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cc-connect-provider-profile.test.ts
  - tests/unit/codex-cli-bridge.test.ts
  - tests/unit/codex-paths.test.ts
  - tests/unit/cc-connect-runtime-provider.test.ts
  - tests/unit/cc-connect-bridge-adapter.test.ts
  - tests/unit/runtime-rpc-contract.test.ts
  - tests/unit/runtime-packaging.test.ts
  - tests/e2e/cc-connect-codex-runtime.spec.ts
  - tests/e2e/cc-connect-real-bundle-smoke.spec.ts
  - tests/e2e/cc-connect-real-oauth-chat.spec.ts
validationCommands:
  - pnpm run bundle:cc-connect:current
  - pnpm run bundle:codex:current
  - pnpm run verify:runtime-bundles
  - pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/codex-cli-bridge.test.ts tests/unit/codex-paths.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts tests/unit/runtime-rpc-contract.test.ts tests/unit/runtime-packaging.test.ts
  - pnpm run test:e2e:cc-connect
  - CLAWX_REAL_OAUTH_E2E=1 CLAWX_E2E_HOME_DIR=<isolated-home> CLAWX_E2E_USER_DATA_DIR=<isolated-user-data> pnpm run test:e2e:cc-connect:real-oauth
acceptance:
  - `pnpm run verify:runtime-bundles` passes for the current platform.
  - `pnpm run test:e2e:cc-connect` passes without real network credentials.
  - `tests/e2e/cc-connect-real-oauth-chat.spec.ts` remains skipped by default and passes only when explicitly enabled with isolated OAuth state.
  - The real OAuth test verifies chat box delivery through cc-connect and Codex using `auth_mode: chatgpt`.
  - Provider-profile output includes `CODEX_HOME` for OAuth mode but excludes `access_token`, `refresh_token`, and `id_token`.
  - The validation report or architecture doc lists real-runtime gaps that remain unverified after mock E2E, including sessions/history reload, cron Management API field mapping, channel lifecycle operations, generated artifact delivery, and process cleanup.
docs:
  required: true
---

cc-connect validation has three layers:

1. Unit and mock E2E coverage for deterministic runtime behavior.
2. Real bundled binary smoke tests for local dev and packaging regressions.
3. Opt-in real OpenAI/Codex OAuth chat tests for end-to-end credential and network validation.

The real OAuth layer must never be part of default CI. It requires a developer to create an isolated `CODEX_HOME` with Codex login, then opt in with `CLAWX_REAL_OAUTH_E2E=1`.

Replacement-readiness follow-up validation must add coverage for:

- operation-level capability reporting instead of only boolean capability groups;
- in-app Codex OAuth login/status/logout/relogin using ClawX-managed `CODEX_HOME`;
- real cc-connect doctor output and Codex doctor JSON under the managed runtime;
- chat abort/cancellation behavior and renderer `aborted` event parity;
- real cc-connect Management API sessions/providers/models/cron endpoints;
- media, file, generated artifact, card, button, and bridge preview/update/delete packets;
- packaged app resource verification after `package:mac:local` and CI equivalents for Windows/Linux;
- port collision handling and process cleanup after restart, crash, app quit, and runtime rollback to OpenClaw.

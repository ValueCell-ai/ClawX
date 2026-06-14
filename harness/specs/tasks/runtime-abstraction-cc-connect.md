---
id: runtime-abstraction-cc-connect
title: Add runtime abstraction and packaged cc-connect runtime support
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Introduce a runtime abstraction so ClawX can keep OpenClaw as the default runtime while exposing cc-connect as an optional packaged runtime.
touchedAreas:
  - .github/**
  - .gitignore
  - AGENTS.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - clawx-extensions.json
  - docs/**
  - harness/specs/**
  - harness/src/**
  - harness/specs/tasks/runtime-abstraction-cc-connect.md
  - electron/api/**
  - electron/extensions/**
  - electron/gateway/**
  - electron/main/**
  - electron/services/**
  - electron/main/ipc/**
  - electron/runtime/**
  - electron/shared/providers/**
  - electron/utils/**
  - resources/**
  - shared/**
  - src/**
  - src/lib/host-api.ts
  - src/stores/settings.ts
  - src/pages/Settings/index.tsx
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/settings.json
  - shared/types/gateway.ts
  - scripts/**
  - tests/e2e/**
  - tests/fixtures/**
  - tests/unit/**
  - tests/**
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
  - tsconfig.node.json
  - tsconfig.web.json
  - vite.config.ts
  - vitest.config.ts
expectedUserBehavior:
  - OpenClaw remains the default runtime and existing Gateway UI keeps working.
  - Settings exposes a runtime selector with OpenClaw and cc-connect choices.
  - cc-connect can be selected without writing to the user's global ~/.cc-connect directory.
  - Packaged builds contain the cc-connect executable for the target platform.
  - cc-connect chat emits OpenClaw-compatible runtime events, including streamed assistant deltas.
  - cc-connect GUI chat is delivered through cc-connect BridgePlatform; ClawX must not call Codex directly from Chat in cc-connect mode.
  - cc-connect sessions/history/tool artifacts are sourced from cc-connect BridgePlatform, Management API, or cc-connect-owned session stores; ClawX must not read Codex transcript/runtime state files directly.
  - Models token usage includes cc-connect-owned session store usage records and must not read Codex transcript/runtime state files directly.
  - cc-connect mirrors each configured OpenClaw agent to a project that reuses that agent's existing OpenClaw workspace when it exists.
  - cc-connect falls back to a ClawX-managed workspace for agents whose configured OpenClaw workspace path is missing or unset.
  - cc-connect channel accounts run in the project for their bound agent.
  - cc-connect validation covers mock bridge chat, real bundled runtime startup, and opt-in real Codex OAuth chat.
  - cc-connect replacement readiness is tracked separately from initial runtime availability, including capability gaps, OAuth lifecycle, doctor parity, abort parity, and real-runtime validation gaps.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/runtime-manager.test.ts
  - tests/unit/cc-connect-runtime-provider.test.ts
  - tests/unit/cc-connect-bridge-adapter.test.ts
  - tests/unit/cc-connect-provider-profile.test.ts
  - tests/unit/cc-connect-bundle.test.ts
  - tests/unit/token-usage.test.ts
  - tests/unit/token-usage-scan.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/e2e/cc-connect-codex-runtime.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/cc-connect-real-bundle-smoke.spec.ts
  - tests/e2e/cc-connect-real-oauth-chat.spec.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway or cc-connect HTTP endpoints directly.
  - OpenClaw-specific features are capability-aware when cc-connect is selected.
  - cc-connect packaging does not rely on runtime postinstall downloads.
  - App-visible session keys remain `agent:*` while cc-connect bridge storage can use internal `clawx:*` keys.
  - Non-main agents keep separate cc-connect project names and Codex `work_dir` values.
  - cc-connect Codex `work_dir` never defaults to the ClawX source checkout or to `process.cwd()`.
  - cc-connect `reply_stream` packets update the same chat runtime graph path used by OpenClaw assistant deltas.
  - `usage:recentTokenHistory` returns cc-connect session-store usage with app-visible `agent:*` session IDs.
  - `pnpm run verify:runtime-bundles` passes after cc-connect and Codex bundles are prepared.
  - `pnpm run test:e2e:cc-connect` covers mock bridge chat and real bundled runtime startup.
  - Real Codex OAuth chat is gated behind `CLAWX_REAL_OAUTH_E2E=1` and uses isolated userData/CODEX_HOME.
  - `docs/runtime-abstraction-cc-connect.md` records the difference between first-version cc-connect support and replacement-ready OpenClaw parity.
  - Capability documentation names unsupported cc-connect sub-operations such as chat abort, doctor fix, channel lifecycle mutations, and cron toggle rather than implying full parity from a top-level boolean.
docs:
  required: true
---

Runtime abstraction work must preserve the existing renderer/Main boundary. The first cc-connect adapter can expose unsupported capability results for features that do not have a stable cc-connect API yet, but the runtime selector, packaged binary resolver, managed config directory, and OpenClaw compatibility path must be implemented in the same delivery.

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
  - cc-connect mirrors each configured OpenClaw agent to a project that uses that agent's workspace.
  - cc-connect channel accounts run in the project for their bound agent.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/runtime-manager.test.ts
  - tests/unit/cc-connect-runtime-provider.test.ts
  - tests/unit/cc-connect-bridge-adapter.test.ts
  - tests/unit/cc-connect-provider-profile.test.ts
  - tests/unit/codex-cli-bridge.test.ts
  - tests/unit/cc-connect-bundle.test.ts
  - tests/unit/host-api-facade.test.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway or cc-connect HTTP endpoints directly.
  - OpenClaw-specific features are capability-aware when cc-connect is selected.
  - cc-connect packaging does not rely on runtime postinstall downloads.
  - App-visible session keys remain `agent:*` while cc-connect bridge storage can use internal `clawx:*` keys.
  - Non-main agents keep separate cc-connect project names and Codex `work_dir` values.
  - cc-connect `reply_stream` packets update the same chat runtime graph path used by OpenClaw assistant deltas.
docs:
  required: true
---

Runtime abstraction work must preserve the existing renderer/Main boundary. The first cc-connect adapter can expose unsupported capability results for features that do not have a stable cc-connect API yet, but the runtime selector, packaged binary resolver, managed config directory, and OpenClaw compatibility path must be implemented in the same delivery.

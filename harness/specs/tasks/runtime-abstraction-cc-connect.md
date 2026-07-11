---
id: runtime-abstraction-cc-connect
title: Add runtime abstraction and packaged cc-connect runtime support
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Introduce a runtime abstraction so ClawX can keep OpenClaw as the default runtime while exposing cc-connect as an optional packaged runtime.
touchedAreas:
  - .env.cc-connect.local.example
  - .github/**
  - .gitignore
  - AGENTS.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
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
  - cc-connect probes localhost startup ports and falls back from default BridgePlatform/Management API ports when they are occupied; status, Control UI, diagnostics, and Management API calls use the selected port.
  - cc-connect unexpected crashes close the bridge, stop session polling, report an error, and schedule a bounded automatic restart.
  - cc-connect stop/restart terminates the runtime process tree so Codex child processes do not survive runtime switching.
  - cc-connect app quit and rollback to OpenClaw release runtime ports and leave no process referencing the ClawX-managed cc-connect runtime directory in real bundled-runtime Electron smoke tests.
  - macOS dir-packaged smoke starts `release/mac-arm64/ClawX.app`, verifies packaged `Contents/Resources/cc-connect` and `Contents/Resources/codex`, starts cc-connect through packaged resolver paths, validates packaged Host API cron lifecycle and doctor execution, verifies rollback-to-OpenClaw cleanup, verifies app-quit cleanup, and can opt into packaged real OAuth GUI chat with `--real-oauth=1`.
  - cc-connect chat emits OpenClaw-compatible runtime events, including streamed assistant deltas.
  - cc-connect GUI chat is delivered through cc-connect BridgePlatform; ClawX must not call Codex directly from Chat in cc-connect mode.
  - cc-connect BridgePlatform media packets (`image`, `file`, `audio`) are converted into shared chat messages with `_attachedFiles`; base64 media is persisted under ClawX-managed cc-connect userData media roots.
  - cc-connect BridgePlatform tool, command, and patch packets are converted into shared runtime events; file-editing tool calls are persisted as `toolCall` content blocks for generated-file extraction.
  - cc-connect sessions/history/tool artifacts are sourced from cc-connect BridgePlatform, Management API, cc-connect-owned session stores, or managed Codex transcript rows that are linked to cc-connect-owned session stores; ClawX must not read user-global Codex transcript/runtime state files directly.
  - Models token usage includes cc-connect-owned session store usage records and may consume managed Codex `token_count` rows only when they are attributable by session-store linkage or `session_meta.cwd` matching a configured/managed cc-connect workspace; user-global or unattributed Codex transcript/runtime state files must be ignored.
  - cc-connect mirrors each configured OpenClaw agent to a project that reuses that agent's existing OpenClaw workspace when it exists.
  - cc-connect falls back to a ClawX-managed workspace for agents whose configured OpenClaw workspace path is missing or unset.
  - cc-connect channel accounts run in the project for their bound agent.
  - cc-connect channel config changes reload through the Management API when possible; real bundled-runtime smoke must prove reload keeps the same cc-connect pid/port and that ClawX channel status reads live project platform `connected`/`running` state.
  - cc-connect validation covers mock bridge chat, real bundled runtime startup, opt-in real Codex OAuth chat, session/history, restart reload, delete semantics, project workspace isolation, skills mirroring, and prompt cron create/list/run/toggle/delete.
  - Runtime status exposes operation-level support metadata so degraded cc-connect sub-operations are visible before callers invoke them.
  - Cron and channel runtime actions consult operation-level support metadata before invoking runtime-specific mutations.
  - Runtime diagnostics expose active runtime status, operation capabilities, cc-connect managed paths, Codex OAuth status, sanitized provider profile data, bundle metadata/version command output, Management API health, and runtime log tail without exposing OAuth tokens or management tokens.
  - Skills UI resolves source and runtime mirror directories through Host API so cc-connect opens the managed Codex skills mirror instead of hardcoding the OpenClaw skills directory.
  - File/media staging and outgoing media record lookup use runtime-aware roots so cc-connect attachments stay inside ClawX-managed userData instead of ~/.openclaw.
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
  - tests/unit/e2e-local-real-env.test.ts
  - tests/unit/token-usage.test.ts
  - tests/unit/token-usage-scan.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/extension-host-api-contributions.test.ts
  - tests/e2e/cc-connect-codex-runtime.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/cc-connect-real-bundle-smoke.spec.ts
  - tests/e2e/cc-connect-real-oauth-chat.spec.ts
  - tests/e2e/cc-connect-real-comprehensive.spec.ts
  - tests/e2e/settings-runtime-selector.spec.ts
acceptance:
  - Renderer does not add direct IPC calls.
  - Renderer does not fetch Gateway or cc-connect HTTP endpoints directly.
  - OpenClaw-specific features are capability-aware when cc-connect is selected.
  - cc-connect packaging does not rely on runtime postinstall downloads.
  - App-visible session keys remain `agent:*` while cc-connect bridge storage can use internal `clawx:*` keys.
  - Non-main agents keep separate cc-connect project names and Codex `work_dir` values.
  - cc-connect Codex `work_dir` never defaults to the ClawX source checkout or to `process.cwd()`.
  - cc-connect `reply_stream` packets update the same chat runtime graph path used by OpenClaw assistant deltas.
  - cc-connect bridge registration declares media capabilities only when the adapter maps media packets into renderer-visible attachments.
  - cc-connect bridge registration declares tool/command/patch capabilities only when the adapter maps those packets into shared runtime events and generated-file `toolCall` messages.
  - `usage:recentTokenHistory` returns cc-connect session-store usage with app-visible `agent:*` session IDs.
  - `pnpm run verify:runtime-bundles` passes after cc-connect and Codex bundles are prepared.
  - `pnpm run test:e2e:cc-connect` covers mock bridge chat, real bundled runtime startup, and real bundled runtime startup with default cc-connect ports occupied.
  - `pnpm run test:e2e:cc-connect` covers real bundled runtime process cleanup on app quit and runtime rollback to OpenClaw.
  - `tests/e2e/cc-connect-real-bundle-smoke.spec.ts` covers local real-binary diagnostics through Host API, channel config reload, and live project platform status without requiring external channel credentials.
  - `tests/e2e/cc-connect-real-bundle-smoke.spec.ts` covers real cc-connect Management API cron create/list/update/toggle/delete for a non-main project without requiring model credentials, including exec/work_dir/session_mode/timeout field preservation and ClawX `continue` to cc-connect `reuse` session-mode translation.
  - `tests/e2e/cc-connect-real-bundle-smoke.spec.ts` covers real `cc-connect doctor user-isolation` through the Host API against the managed config.
  - `pnpm run package:mac:dir && pnpm run smoke:cc-connect:packaged -- --app=release/mac-arm64/ClawX.app` validates macOS packaged resource paths, runtime startup, Host API cron lifecycle, doctor execution, rollback cleanup, and runtime cleanup; adding `--real-oauth=1` also validates packaged GUI chat through managed Codex OAuth without exposing token material in public provider profile output.
  - Unit lifecycle coverage proves unexpected crash restart and intentional stop behavior for cc-connect.
  - Real Codex OAuth validation is gated behind `CLAWX_REAL_OAUTH_E2E=1` and uses isolated userData/CODEX_HOME.
  - Direct real OpenAI API-key and Feishu/Lark E2E specs load default local env files only when repository-local files are untracked and gitignored, may additionally load `CLAWX_REAL_ENV_FILE` or `CLAWX_REAL_ENV_FILES`, and never override explicit process environment values.
  - Gated real OAuth coverage validates chat, direct cross-agent research chat with session title/preview summary parity, session summary/history, token usage entries for main and research `agent:*` sessions, restart reload, delete semantics, project workspace isolation, a real Codex file-writing tool turn with cc-connect history tool evidence, skills mirroring, and prompt cron create/list/run/toggle/delete through real cc-connect plus bundled Codex.
  - `docs/runtime-abstraction-cc-connect.md` records the difference between first-version cc-connect support and replacement-ready OpenClaw parity.
  - Capability documentation names unsupported or degraded cc-connect sub-operations such as doctor fix, upstream per-platform channel connect/disconnect endpoints, exec cron manual run, and upstream single-run chat cancellation rather than implying full parity from a top-level boolean.
  - Settings exposes a runtime diagnostics copy action backed by the Host API diagnostics snapshot.
  - Skills page folder actions use `skills.target` rather than `openclaw.getSkillsDir` when selecting the active runtime target.
docs:
  required: true
---

Runtime abstraction work must preserve the existing renderer/Main boundary. The first cc-connect adapter can expose unsupported capability results for features that do not have a stable cc-connect API yet, but the runtime selector, packaged binary resolver, managed config directory, and OpenClaw compatibility path must be implemented in the same delivery.

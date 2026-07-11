---
id: cc-connect-runtime-validation
title: Validate cc-connect runtime with real bundles and gated Codex/OpenAI credentials
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make cc-connect runtime validation reproducible across mock bridge, real bundled binary startup, and opt-in real Codex OAuth, OpenAI API key, and Feishu/Lark channel checks.
touchedAreas:
  - .env.cc-connect.local.example
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/**
  - harness/specs/**
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - scripts/**
  - electron/extensions/**
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
  - Real bundled cc-connect diagnostics expose runtime state, managed paths, operation capabilities, bundle version probes, provider profile summary, and Management API health without leaking the management token.
  - Real bundled cc-connect validates Management API channel config reload and project platform status without external credentials by using a local webhook platform.
  - Real bundled cc-connect validates Management API cron lifecycle and doctor execution through Host API without external model credentials.
  - Codex OAuth status/import/logout through the real Electron Host API is covered with isolated synthetic auth state and must not read or leak user-global Codex tokens.
  - Real Codex OAuth chat, direct cross-agent session fidelity, and cc-connect-owned token usage can be verified only when a developer explicitly supplies a Codex auth file through `CLAWX_REAL_CODEX_AUTH_JSON` so the import into isolated managed CODEX_HOME is intentional.
  - Real OpenAI API-key chat and real Feishu/Lark channel lifecycle checks remain opt-in and are not default CI gates.
  - Public provider profiles and committed test artifacts never contain OAuth token material.
  - Replacement readiness gaps are explicit, including Developer Mode release gating, expired-token recovery, upstream single-run chat cancellation, OpenClaw Doctor Fix non-parity, real Feishu inbound message delivery, rich media/card/button/preview/update/delete packet delivery beyond generated-file cards, notarized release smoke, and Windows/Linux packaged cleanup.
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
  - tests/unit/codex-paths.test.ts
  - tests/unit/cc-connect-runtime-provider.test.ts
  - tests/unit/cc-connect-bridge-adapter.test.ts
  - tests/unit/runtime-rpc-contract.test.ts
  - tests/unit/runtime-packaging.test.ts
  - tests/unit/cc-connect-local-real-verifier.test.ts
  - tests/e2e/cc-connect-codex-oauth-lifecycle.spec.ts
  - tests/e2e/cc-connect-codex-runtime.spec.ts
  - tests/e2e/cc-connect-real-bundle-smoke.spec.ts
  - tests/e2e/cc-connect-real-comprehensive.spec.ts
  - tests/e2e/cc-connect-real-openai-api-key.spec.ts
  - tests/e2e/cc-connect-real-feishu-channel.spec.ts
validationCommands:
  - pnpm run bundle:cc-connect:current
  - pnpm run bundle:codex:current
  - pnpm run verify:runtime-bundles
  - pnpm run verify:cc-connect:local-real
  - pnpm run verify:cc-connect:local-real:oauth-all
  - pnpm run verify:cc-connect:local-real:api-key
  - pnpm run verify:cc-connect:local-real:feishu
  - pnpm run verify:cc-connect:local-real:feishu-inbound
  - pnpm run verify:cc-connect:local-real:scheduled-cron
  - pnpm run verify:cc-connect:local-real:all
  - pnpm run verify:cc-connect:local-real:all-strict
  - pnpm run verify:cc-connect:local-real:replacement-ready
  - pnpm run verify:cc-connect:local-real:replacement-ready:check
  - pnpm run verify:cc-connect:local-real:external-gates:check
  - pnpm run verify:cc-connect:local-real:external-gates
  - pnpm run verify:cc-connect:local-real:handoff
  - pnpm run verify:cc-connect:local-real:packaged-oauth
  - pnpm exec vitest run tests/unit/cc-connect-provider-profile.test.ts tests/unit/codex-paths.test.ts tests/unit/cc-connect-runtime-provider.test.ts tests/unit/cc-connect-bridge-adapter.test.ts tests/unit/runtime-rpc-contract.test.ts tests/unit/runtime-packaging.test.ts tests/unit/cc-connect-local-real-verifier.test.ts tests/unit/e2e-local-real-env.test.ts
  - pnpm run test:e2e:cc-connect:codex-oauth-lifecycle
  - pnpm run test:e2e:cc-connect
  - CLAWX_REAL_OAUTH_E2E=1 CLAWX_E2E_HOME_DIR=<isolated-home> CLAWX_E2E_USER_DATA_DIR=<isolated-user-data> pnpm run test:e2e:cc-connect:real-comprehensive
  - CLAWX_REAL_OPENAI_API_KEY_E2E=1 CLAWX_REAL_OPENAI_API_KEY=<key> pnpm run test:e2e:cc-connect:real-openai-api-key
  - CLAWX_REAL_FEISHU_E2E=1 CLAWX_REAL_FEISHU_APP_ID=<app-id> CLAWX_REAL_FEISHU_APP_SECRET=<app-secret> pnpm run test:e2e:cc-connect:real-feishu
  - CLAWX_REAL_FEISHU_INBOUND_E2E=1 CLAWX_REAL_FEISHU_APP_ID=<app-id> CLAWX_REAL_FEISHU_APP_SECRET=<app-secret> pnpm run test:e2e:cc-connect:real-feishu-inbound
  - CLAWX_REAL_SCHEDULED_CRON_E2E=1 pnpm run test:e2e:cc-connect:real-scheduled-cron
  - CLAWX_REAL_SCHEDULED_PROMPT_CRON_E2E=1 CLAWX_REAL_CODEX_AUTH_JSON=<auth-json> pnpm run test:e2e:cc-connect:real-scheduled-prompt-cron
acceptance:
  - `pnpm run verify:runtime-bundles` passes for the current platform.
  - `pnpm run verify:cc-connect:local-real` writes a sanitized local real-validation report that records available bundles, local OAuth state, opt-in credential preconditions, packaged app availability, local env-file presence plus untracked/gitignore safety, residual process cleanup status, and a runtime parity coverage matrix without writing secret values.
  - The local OAuth state summary records only token key names, missing required token-key names, and sanitized expiry metadata; it must not write token values, and an explicit `CLAWX_REAL_CODEX_AUTH_JSON` file must be reported as a missing real OAuth precondition instead of being copied into managed `CODEX_HOME` when it is incomplete or clearly expired. A complete Codex OAuth auth file requires non-empty `access_token`, `account_id`, `id_token`, and `refresh_token` fields under `tokens`.
  - `pnpm run verify:cc-connect:local-real:oauth-all` records and runs both dev comprehensive and packaged macOS cc-connect real OAuth smokes when `CLAWX_REAL_CODEX_AUTH_JSON` points at a token-bearing Codex auth file.
  - `pnpm run verify:cc-connect:local-real:api-key` records and runs credential-free local OpenAI-compatible API-key chat and chat-abort smokes through real Electron, real cc-connect, and bundled Codex, and additionally runs the real OpenAI API-key smoke when `CLAWX_REAL_OPENAI_API_KEY` or `OPENAI_API_KEY` is available from process env or an untracked and gitignored local env file.
  - `pnpm run verify:cc-connect:local-real:feishu` records and runs the real Feishu/Lark lifecycle smoke when Feishu/Lark app credentials and `CLAWX_REAL_CODEX_AUTH_JSON` are available from process env or an untracked and gitignored local env file.
  - `pnpm run verify:cc-connect:local-real:feishu-inbound` records and runs the manual real Feishu/Lark inbound marker smoke when Feishu/Lark app credentials, `CLAWX_REAL_CODEX_AUTH_JSON`, and `CLAWX_REAL_FEISHU_INBOUND_E2E=1` are available; the smoke writes `artifacts/cc-connect/feishu-inbound-marker.json` with the exact marker to send, waits for a sandbox tenant chat to send that marker, and proves the marker appears in the cc-connect managed session store.
  - `pnpm run verify:cc-connect:local-real:scheduled-cron` records and runs a credential-free real scheduled exec cron smoke that waits for the next cc-connect scheduler minute and verifies the enabled job writes through its configured `work_dir`; when `CLAWX_REAL_CODEX_AUTH_JSON` is complete, it also verifies scheduled prompt delivery through the ClawX cc-connect bridge fallback.
  - `pnpm run verify:cc-connect:local-real:all` records and runs every available local real path, writes the external gate handoff from the same sanitized report, and keeps unavailable credential paths as explicit skipped checks and skipped command records in both JSON and Markdown reports unless `--strict-real` is used.
  - `pnpm run verify:cc-connect:local-real:all-strict` exits non-zero when release-candidate real credential preconditions are missing or when replacement readiness is not achieved, while still writing the sanitized report, external gate handoff, missing-precondition rows, and coverage rows.
  - `pnpm run verify:cc-connect:local-real:replacement-ready` exits non-zero when any required replacement-readiness coverage row is skipped, failed, missing, or not-run; it writes the external gate handoff and may leave missing credentials represented by the replacement-readiness failure rather than a separate strict preflight failure.
  - `pnpm run verify:cc-connect:local-real:replacement-ready:check` runs the same replacement-readiness hard gate with `--no-write`, so a quick gate check cannot overwrite the last full local-real report artifact.
  - `pnpm run verify:cc-connect:local-real:external-gates:check` runs only the remaining required external gate paths for real OpenAI API-key chat, Feishu/Lark live lifecycle, and Feishu/Lark inbound tenant-message delivery, but uses `--no-write` so missing credentials or partial external evidence cannot overwrite the last full local-real report. The command must still print sanitized missing-precondition ids, required variable names, and next commands to stdout.
  - `pnpm run verify:cc-connect:local-real:external-gates` runs the same focused external gate paths, writes the external gate handoff, and exits non-zero unless all three external coverage rows are `PASS`.
  - `pnpm run verify:cc-connect:local-real:handoff` reads the latest sanitized local real-validation report and writes `artifacts/cc-connect/local-real-external-gates.{md,json}` as credential-free human-readable and machine-readable handoff checklists for the remaining real OpenAI API-key, Feishu/Lark lifecycle, and Feishu/Lark inbound tenant-message gates. The verifier's `--write-handoff` flag must write the same checklists from the in-memory report in the same validation run.
  - The local real-validation report includes a dedicated `channel-lifecycle-local-bundle` coverage row for bundled cc-connect Host API `channels.connect` and `channels.disconnect`, managed config reload without restart, real user channel credential removal, local placeholder platform preservation, and credential-free Feishu/Lark config projection for domain aliases, agent binding, account-scoped status, and workspace isolation; this local row must not satisfy or replace the `feishu-live-channel-lifecycle` coverage row.
  - The local real-validation report includes a dedicated `cron-lifecycle-local-bundle` coverage row for bundled cc-connect Management API cron create/list/update/toggle/delete, non-main agent project routing, prompt and exec field mapping, explicit external delivery metadata pass-through, `work_dir`, `session_mode`, `timeout_mins`, `mute`/`silent`, stable unsupported handling for non-cron `at`/`every` schedules, and manual exec-run unsupported semantics; this local row must not satisfy or replace live scheduled-delivery or tenant channel-delivery evidence.
  - The local real-validation report includes a dedicated `scheduled-cron-delivery-local-bundle` coverage row for opt-in real scheduler delivery of an enabled exec cron without external credentials; when this row is PASS, the follow-up `real-scheduled-cron-delivery` validation gap must disappear. The report also includes `scheduled-prompt-cron-delivery-local-bundle` when the scheduled prompt smoke is run; a PASS on that row proves local BridgePlatform prompt delivery but must not claim live tenant-channel delivery parity.
  - The local real-validation report records sanitized missing-precondition rows with required variable names and next validation commands, without writing credential values.
  - Credential-gated coverage rows such as real OpenAI API-key chat, Feishu/Lark live lifecycle, real OAuth comprehensive, and packaged OAuth smoke must be marked `skipped` with the missing-precondition reason when their required local preconditions are absent, even if the opt-in child command was not requested in that verifier run. If the preconditions are present but the command was simply not requested, the row remains `not-run`.
  - The local real-validation verifier loads the same additional explicit env-file entrypoints as direct real E2E (`CLAWX_REAL_ENV_FILE` and path-delimited `CLAWX_REAL_ENV_FILES`) in addition to `--env-file=<path>`, while preserving process-env precedence and reporting only file basenames plus variable names.
  - Loaded local env files inside the repository must be untracked and gitignored; unsafe repo-local env files must not be parsed, must not expose variable names, and must not pass values to child validation commands. Explicit env files outside the repository may be loaded but reports identify them only as outside-repo summaries without absolute paths.
  - Direct real E2E env helpers must skip unsafe repo-local env files without throwing during test module import, so API-key and Feishu/Lark specs still compile and then skip normally when credentials are unavailable.
  - Direct real OpenAI API-key and Feishu/Lark E2E specs load the same default local env files as the verifier only when repository-local files are untracked and gitignored, may additionally load `CLAWX_REAL_ENV_FILE` or `CLAWX_REAL_ENV_FILES`, and must not override explicit process environment values.
  - Direct E2E local env-file summaries must not expose absolute paths for explicit files outside the repository.
  - `.env.cc-connect.local.example` documents local real-validation credential fields without containing real credential values.
  - The Codex OAuth lifecycle local diagnostics row runs deterministic verifier coverage for explicit auth import requirement, complete Codex token field requirement, expired auth rejection, sanitized expiry metadata, and missing token-key reporting without exposing token values; this row is part of replacement readiness, while live browser relogin and expired-token recovery remain follow-up gaps.
  - The `codex-oauth-host-api-lifecycle-local` row runs a real Electron Host API E2E for `providers.codexOAuthStatus`, `providers.importCodexOAuth`, and `providers.logoutCodexOAuth` using isolated synthetic Codex auth state. It must verify managed auth-file creation/deletion, provider OAuth secret cleanup, public provider-profile redaction, response redaction, and that stopped-runtime profile sync does not require a dev Codex bundle.
  - The local real-validation report includes `coverage` JSON and a Markdown `Runtime Parity Coverage` table that maps runtime parity areas to evidence commands for current bundles, BridgePlatform-only runtime boundary diagnostics, session/history parity local diagnostics, compile/skip paths, Codex OAuth lifecycle local diagnostics, Codex OAuth Host API lifecycle, provider/model profile local diagnostics, token usage contract local diagnostics, runtime management bundle local diagnostics, BridgePlatform image/file/audio packet diagnostics, BridgePlatform rich packet diagnostics, channel lifecycle local bundle semantics, cron lifecycle local bundle semantics, scheduled exec cron delivery, scheduled prompt cron BridgePlatform fallback delivery, OAuth core parity, generated-file card real OAuth delivery, local OpenAI-compatible API-key chat, local OpenAI-compatible chat abort, real OpenAI API-key provider/model chat, Feishu/Lark channel lifecycle, and packaged OAuth smoke.
  - The local OpenAI-compatible API-key row verifies OpenAI API-key provider `baseUrl`, model propagation, bearer auth, secret redaction, and chat delivery through real cc-connect plus bundled Codex against a local Responses-compatible server, but it must not satisfy or replace the real OpenAI API-key provider/model chat row in replacement readiness.
  - The `chat-abort-local-openai-compatible` coverage row verifies a delayed local OpenAI-compatible Responses stream through real cc-connect plus bundled Codex, the GUI Stop button, Host API `chat.abort`, restart-based cc-connect cancellation, late assistant output suppression, and recovery to `running`; this row is part of replacement readiness, while upstream single-run cancellation remains a follow-up gap.
  - The provider/model profile local diagnostics row runs deterministic unit coverage for API-key/OAuth/custom Responses materialization, unsupported-provider diagnostics, secret redaction, and running-runtime provider/model sync restart, but it is not a replacement for the real OpenAI API-key provider/model chat row and must not be counted as replacement-ready live credential evidence.
  - The token usage contract local diagnostics row runs deterministic unit and Electron IPC coverage for cc-connect-owned session-store usage, managed `CODEX_HOME` `token_count` usage attributed by session-store linkage or managed-workspace `session_meta.cwd`, `runtimeKind` tagging and filtering, cross-agent session ids, OpenClaw-compatible cron session ids, agent named/orphan session ids, channel-session key preservation, common cost field variants such as `total_cost_usd` and `cost.total_usd`, and exclusion of user-global or unattributed Codex transcripts, but it is not a replacement for real OAuth/API-key live usage and live cost-value evidence.
  - The runtime management bundle local diagnostics row runs real bundled cc-connect E2E coverage for startup, diagnostics redaction, fallback ports, Management API channel reload/status, Management API cron lifecycle, cc-connect doctor user-isolation, quit cleanup, and rollback cleanup, but it is not a replacement for real Feishu/Lark tenant-delivery coverage.
  - The `bridge-media-packets-local-diagnostics` row runs deterministic BridgePlatform adapter coverage for image/file/audio packets, cc-connect managed media writes, image data-URL previews, and file/audio preview suppression. It proves shared message mapping only and must not replace real rich card/button/preview/update/delete packet evidence from an upstream cc-connect session.
  - The `bridge-rich-packets-local-diagnostics` row runs deterministic BridgePlatform adapter coverage for card/buttons, preview acknowledgements, update-message deltas, delete-message no-op stability, and typing no-op stability. It proves shared protocol handling only and must not replace real upstream rich card/button/preview/update/delete packet evidence.
  - The local real-validation report includes `ccConnectCliSurface` JSON and a Markdown `cc-connect Upstream CLI Surface` section from the bundled binary, including command, cron, sessions, providers, Feishu/Lark, channel lifecycle evidence, and missing upstream primitives such as undocumented per-platform channel connect/disconnect.
  - The local real-validation report includes a top-level `runtimeMatrixStatus`, a `replacementReadiness` JSON object, and a Markdown `Replacement Readiness` section derived from required replacement rows; skipped or not-run OpenAI API-key and Feishu/Lark rows must keep `runtimeMatrixStatus` `partial`, include the next command to run, and may set the overall report status to `fail` only when `--require-replacement-ready` is used as a hard gate.
  - The local real-validation report includes a machine-readable `replacementContract` checklist and Markdown `Replacement Contract Checklist` section that maps the current cc-connect replacement decisions to evidence: Developer Mode gating remains unchanged, Doctor Fix non-parity is explicit, BridgePlatform-only runtime ownership forbids direct ClawX-to-Codex chat/session/history/tool execution, Codex OAuth/OpenAI API-key verification is tracked separately, provider/model matrix limitations are not implied parity, Feishu/Lark local projection is not live tenant delivery, cron lifecycle/scheduled exec/scheduled prompt BridgePlatform delivery is not live tenant-channel delivery parity, session/history rename/delete/title/cross-agent contracts and token usage contracts are tied to runtime-owned evidence, real validation remains opt-in, and all-platform packaging smoke remains a release-validation item.
  - The local real-validation check table always includes a `replacement-readiness` row. It must be `PARTIAL` for informational partial reports and `FAIL` only when `--require-replacement-ready` is used as the hard gate, so `required-coverage` success for a selected subset cannot be mistaken for full replacement readiness.
  - `--no-write` must preserve the last JSON/Markdown report artifacts while still returning the same hard-gate exit status and printing a sanitized console summary, allowing non-destructive replacement-readiness checks after a full local-real run.
  - The local real-validation report includes `validationGaps` JSON and a Markdown `Validation Gaps` table that distinguishes required local replacement-gate gaps from follow-up full-parity evidence gaps. The required replacement gate includes real OpenAI API-key chat, real Feishu/Lark lifecycle, and real Feishu/Lark inbound marker delivery; follow-up full-parity evidence gaps include real scheduled prompt/channel cron delivery as a separate gap from scheduled exec delivery, rich media/card/button/preview/update/delete packet delivery beyond generated-file cards, notarized macOS dmg/zip smoke, and Windows/Linux packaged smoke.
  - The local real-validation report includes sanitized `nextActions` JSON and a Markdown `Next Actions` section that turns missing OpenAI API-key, Feishu/Lark credentials, non-PASS replacement-readiness coverage, and upstream primitive gaps into concrete follow-up commands or actions without writing secret values.
  - The external gate handoff artifacts must be generated only from sanitized report metadata, must include the follow-up commands and required environment variable names for the remaining external gates, and must not include API-key values, OAuth token values, app secret values, generated auth file contents, or tenant-private data beyond the intentionally sanitized Feishu/Lark marker artifact path. The JSON artifact must be stable enough for local CI/handoff automation to consume without parsing Markdown. `--no-write` must suppress handoff output even when `--write-handoff` is present.
  - `--external-gates-only` must skip the safe local baseline commands and execute only explicitly included credential-gated paths, so external gate reruns after credentials are configured do not require rerunning the full local matrix.
  - Unit coverage protects local real-verifier argument parsing, deterministic coverage-id expansion, unknown coverage-id failure, skipped/not-run required coverage failure, command-to-coverage mapping, replacement-readiness summaries, structured validation-gap output, sanitized Codex OAuth expiry summaries, incomplete-auth and expired-auth precondition handling, next-action generation, direct E2E local env-file loading precedence, explicit env-file expansion, and explicit outside-repo path redaction.
  - `pnpm run verify:cc-connect:local-real:packaged-oauth` records and runs packaged macOS cc-connect real OAuth smoke when the packaged app is available and `CLAWX_REAL_CODEX_AUTH_JSON` points at a token-bearing Codex auth file.
  - `pnpm run test:e2e:cc-connect` passes without real network credentials.
  - Real bundle E2E proves channel config reload keeps the same runtime pid/port and that ClawX channel status reads cc-connect project platform `connected`/`running` state; deterministic unit coverage must also protect same-project multi-account Feishu/Lark status mapping.
  - Real bundle E2E proves cc-connect cron create/list/update/toggle/delete for a non-main project, exec/work_dir/session_mode/timeout field preservation, ClawX `continue` to cc-connect `reuse` session-mode translation, and `cc-connect doctor user-isolation` through Host API; deterministic unit coverage must also protect explicit external delivery metadata pass-through.
  - `tests/e2e/cc-connect-real-comprehensive.spec.ts` remains skipped by default and passes only when explicitly enabled with isolated OAuth state.
  - The real comprehensive OAuth test verifies chat box delivery, direct cross-agent research chat/session summary, main/research `agent:*` token usage entries, prompt cron paths, a real Codex file-writing tool turn with cc-connect history tool evidence, and an `apply_patch` generated-file card rendered in GUI chat through cc-connect and Codex using `auth_mode: chatgpt`.
  - Deterministic bridge-adapter coverage protects session/title parity for cc-connect persisted stores: named/orphan agent sessions use stable `agent:<agent>:<storeSessionId>` keys, keep explicit names, runtime-routed rename updates cc-connect-owned active/direct/supplemental labels without writing OpenClaw `sessions.json`, and active/base session rename does not mutate unrelated named/orphan records.
  - `tests/e2e/cc-connect-real-openai-api-key.spec.ts` includes a default local OpenAI-compatible API-key smoke and also validates real OpenAI API-key chat, secret redaction, and managed runtime process cleanup when explicitly enabled.
  - `tests/e2e/cc-connect-real-feishu-channel.spec.ts` remains skipped by default and validates real Feishu/Lark config projection, runtime status, lifecycle reload, delete cleanup, domain alias mapping, managed runtime process cleanup, and, when `CLAWX_REAL_FEISHU_INBOUND_E2E=1` is enabled, writes a sanitized marker handoff artifact then verifies the manual inbound tenant-message marker is stored by cc-connect; it still does not prove undocumented per-platform connect/disconnect primitives.
  - Packaged macOS dir smoke supports `--real-oauth=1` to validate packaged GUI chat through managed Codex OAuth while asserting public provider-profile output excludes token material.
  - Provider-profile output includes `CODEX_HOME` for OAuth mode but excludes `access_token`, `refresh_token`, and `id_token`.
  - The validation report or architecture doc lists real-runtime gaps that remain unverified after mock E2E and gated real-credential E2E, including live Feishu inbound delivery, live tenant-channel scheduled cron delivery, real upstream rich card/button/preview/update/delete packet delivery beyond generated-file cards and adapter-level media/rich packet fixtures, notarized dmg/zip validation, and Windows/Linux packaged cleanup.
docs:
  required: true
---

cc-connect validation has three layers:

1. Unit and mock E2E coverage for deterministic runtime behavior.
2. Real bundled binary smoke tests for local dev and packaging regressions.
3. Opt-in real OpenAI/Codex OAuth, OpenAI API-key, and Feishu/Lark tests for end-to-end credential and network validation.

The real credential layer must never be part of default CI. OAuth requires a developer to explicitly provide `CLAWX_REAL_CODEX_AUTH_JSON` pointing at the Codex auth file that may be copied into an isolated managed `CODEX_HOME`, then opt in with `CLAWX_REAL_OAUTH_E2E=1`. The local verifier records sanitized auth expiry metadata and must reject incomplete or clearly expired explicit auth files before child commands run. The local verifier may read untracked and gitignored `.env.cc-connect.local`, `.env.local`, `.env`, or an explicit `--env-file=<path>` and pass those values only to child validation commands. Explicit env files inside the repository must be untracked and gitignored; unsafe repo-local env files must not be loaded or parsed. Env files outside the repository are allowed but must not be reported with absolute paths. `.env.cc-connect.local.example` is a checked-in template and must contain only variable names, placeholders, and comments. OpenAI API-key and Feishu/Lark checks require explicit opt-in commands and remain skipped by default when credentials are unavailable.

Replacement-readiness follow-up validation must add coverage for:

- operation-level capability reporting instead of only boolean capability groups;
- expired-token recovery and live browser relogin using ClawX-managed `CODEX_HOME`;
- real cc-connect doctor output and Codex doctor JSON under the managed runtime;
- upstream single-run chat cancellation behavior beyond ClawX's restart-based `aborted` parity;
- real cc-connect Management API sessions/providers/models endpoints, with cross-agent session fidelity proven through the runtime-facing Host API;
- real cc-connect Management API reload and project platform status for channels;
- live Feishu/Lark inbound message delivery through a tenant chat must be covered by the opt-in inbound marker smoke before replacement readiness can pass;
- real upstream rich card/button/preview/update/delete packets beyond generated-file cards and adapter-level media/rich bridge fixtures;
- notarized macOS dmg/zip validation plus CI equivalents for Windows/Linux packaged resource paths and cleanup.

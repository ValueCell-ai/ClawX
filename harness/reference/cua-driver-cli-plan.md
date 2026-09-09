# CUA Driver CLI Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX's custom OpenClaw Computer Use plugin and MCP bridge with native bundled `cua-driver` CLI calls guided by the official CUA Skill.

**Architecture:** Keep Electron Main's existing `EmbeddedCuaDriverHost`, default-off preference, permission UI, and daemon supervision. Publish its private endpoint for existing OpenClaw exec tools to invoke the bundled executable directly; use ordinary image-capable `read` for screenshots. Vendor the matching upstream Skill with a small, explicit ClawX integration entrypoint rather than maintaining another action adapter.

**Tech Stack:** Electron, TypeScript, OpenClaw 2026.7.1-2, CUA Driver/SDK 0.21.0, pnpm, Vitest, Playwright.

## Execution Record

Implemented on 2026-09-09 with the user-confirmed `computer-use` name. Runtime,
adapter retirement, upstream Skill integration, locale/docs updates, and automated
validation are complete. Real exec/read/provider-serialization coverage lives in
`tests/unit/cua-cli-exec.test.ts` and `tests/fixtures/cua-cli/`, rather than a second
Electron fixture duplicating that path. Existing Electron management and picker
specs exercise the actual installed app integration.

The native development-host checks verified endpoint lifecycle, named-session
continuity, window capture and a window-existence predicate. AX/window input on
the observed Electron window was not verified successful. Windows packaging,
signed-release attribution and controlled model latency comparisons remain
unverified. See `harness/reference/computer-use-cli-validation.md` for exact results.
The checklists below retain the original acceptance targets, not a claim that
every native/platform target has been met. No commit or push was performed.

## Global Constraints

- Implementation was approved on 2026-09-09. The user permits launching `CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev` and testing with Playwright Electron. Keep native input confined to explicit test tasks; do not request or change OS permissions automatically.
- User approved retaining Main-owned daemon lifecycle and the Computer Use management page.
- User approved native window, accessibility, menu, and verification capabilities instead of the former primary-display-only adapter.
- The previous implementation was internal-only. Replace the old Skill in place, retaining the `computer-use` name and `/computer-use` picker command. Document that it is based on the official CUA 0.21.0 accompanying Skill. Do not build a general legacy migration framework or retain the old model tool.
- Keep macOS 13+ Intel/Apple silicon and Windows x64 support. Do not add Linux or Windows ARM64 support merely because upstream documents them.
- Keep pinned binaries, archive SHA256 verification, existing bundled-bin layout, SDK dependencies, ASAR loading, and parent-liveness behavior.
- Renderer uses typed host-api only. Model operations use existing OpenClaw exec/read tools, not a new Renderer API, OpenClaw plugin, MCP server, or CLI action wrapper.
- Do not change global exec approvals, sandbox policy, or image settings to make this feature work. Unsupported execution/filesystem contexts must report the limitation.
- New UI text requires en/zh/ja/ru coverage and Electron E2E coverage. Review all three READMEs.
- Start implementation with a task spec referencing `gateway-backend-communication`. Validate using the real diff; run selected harness flow and communication regressions.
- Review checkpoints below are logical commit boundaries only. Do not commit or push without a separate explicit request.

## Research Findings

### Actual capability boundary

Local `resources/openclaw-plugins/clawx-cua-computer/computer-tool.mjs` exposes 13 screenshot/input/wait actions and hardcodes the primary desktop. It does not expose window state, element tokens, menus, or `verify_state`.

This is not a fundamental MCP or `computer` tool limitation. Official OpenClaw at commit `f74837eec91453eb26ec18de94f907a0698721e7` exposes window/element/menu operations through its computer provider contract. Its desktop branch remains primary-display-only. Its current plugin depends on CUA 0.22.2, so it is not the contract authority for our pinned binary. The exact upstream revision originally used as the local implementation reference is unknown.

### CLI and existing embedded host

- The installed SDK's `EmbeddedDriverConnection` already contains `socketPath`, `generation`, and `driverVersion`; ClawX's local connection interface currently omits them.
- Pinned CLI one-shot calls accept `--socket PATH`, require an already-running compatible daemon, and do not auto-start one.
- Ordinary CLI calls can reach the existing embedded endpoint as the same OS user. No new bearer token, MCP initialization, or trusted-host handshake is required. The daemon remains the process performing OS operations.
- `--embedded` is already set by Main's SDK on the daemon. It is not necessary on the one-shot CLI client; do not duplicate host permission flags in model commands.
- Explicit, non-default named sessions persist across separate CLI calls in the pinned implementation. Anonymous calls receive disposable sessions. Repeat a unique workflow label on every accepting call and call `end_session` when finished.
- CLI stdout is not a universal JSON envelope. Nested tool errors and some screenshot-write errors can exit zero. Never use shell `&&` or exit status alone as proof of an action's semantic success.
- JSON `screenshot_out_file` writes the image in the daemon and returns its path, avoiding image base64 transport. CLI `--screenshot-out-file` extracts returned images in the client and is not identical. Prefer the JSON argument for state captures; use absolute fresh `.png` paths whose parent already exists.

### Model image path

OpenClaw's ordinary `read` emits an image content block to the current model; the separate `image` tool delegates to another configured model and is not required here. Workspace-only and sandbox read restrictions still apply. Use a task-owned directory within the active local agent workspace, not a hardcoded system temporary directory or the Skill directory.

Read can resize images twice: the underlying tool has a 2000px default, followed by OpenClaw's default 1200px sanitizer. Earlier scale notes may not describe the final image. Prefer native element tokens; for pixel fallback, preserve original dimensions and verify the final image-to-driver coordinate mapping. Do not claim file bytes equal model-visible dimensions or globally change image settings.

### Performance hypothesis

The intended improvement is fewer model decisions and less repeated visual interpretation, not a promise that CLI transport is inherently faster than MCP. Remove the adapter's unconditional 500ms sleep and automatic full-desktop screenshot after every input. Use window/element/menu operations, bounded `verify_state`, filtered trees, and locally grouped action-plus-observation commands when the next step does not require a new decision. Never turn this into a blind multi-action loop or rely on exit codes for branching.

### Official Skill reuse

Vendor release tag `cua-driver-rs-v0.21.0`, commit `70db98d1bcd92890d778f4978e0eb107a4b66c1b`. Upstream main inspected at `00678fa8ec8f0f371716993ae4a207df812ef667` advertises Skill 0.24.0 and contains changed behavior and session guidance; do not combine it with 0.21.0 binaries.

The upstream Skill directory contains eight Markdown files. Preserve source attribution and the repository-root MIT license. Preserve the upstream documents and place a short ClawX entrypoint ahead of them. Explicitly override standalone installation/service/permission instructions and pinned-source discrepancies; an untouched active upstream Skill is not suitable for ClawX.

## Task 1: Establish The Executable Contract

**Files:**
- Create `harness/specs/tasks/cua-driver-cli.md`.
- Modify `harness/specs/rules/local-computer-use.md`, `harness/specs/scenarios/gateway-backend-communication.md`, `harness/reference/computer-use.md`, and `harness/reference/computer-use-skill.md`.
- Create `tests/unit/cua-cli-contract.test.ts`.

**Interfaces:** Pinned 0.21.0 command syntax and supported local exec/read context; no new model tool.

- [ ] Write the task spec and contract fixtures covering explicit private endpoint, named-session continuity, file output versus stdout, and error-result interpretation.
- [ ] Run `pnpm exec vitest run tests/unit/cua-cli-contract.test.ts`; verify failures concern the missing new integration contract, not test setup.
- [ ] Encode assertions against vendored examples and synthetic process/results. Do not make normal unit tests depend on local grants or a daemon.
- [ ] Validate the task with `pnpm harness validate --spec harness/specs/tasks/cua-driver-cli.md` and inspect `pnpm harness run --spec harness/specs/tasks/cua-driver-cli.md --dry-run`.
- [ ] Review checkpoint: agreed contract and validation scope. Live named-session proof is a later acceptance gate, not inferred from mocks.

## Task 2: Expose The Existing Host To CLI Clients

**Files:**
- Modify `electron/utils/cua-runtime.ts`, `electron/services/computer-use-api.ts`, and `electron/gateway/config-sync-env.ts`.
- Modify `tests/unit/cua-runtime.test.ts`, `tests/unit/computer-use-api.test.ts`, and `tests/unit/gateway-process-launcher.test.ts`.

**Interfaces:** Retain `CLAWX_CUA_CONNECTION_FILE` as a stable discovery path. Replace the old payload with `{ v: 2, generation, driverVersion, binaryPath, socketPath }`; paths come from the resolved bundled executable and SDK connection, never parsed from old MCP arguments. No dual-format reader.

- [ ] Add failing tests for the new descriptor, absolute executable/endpoint, atomic publication, disabled/unavailable states, generation replacement, and cleanup.
- [ ] Run the three focused suites and confirm expected failures.
- [ ] Extend the local SDK connection type and publish the CLI descriptor. Retain private file permissions, exit monitoring, explicit permission requests, SDK shutdown, and native loading.
- [ ] Remove plugin install/config-policy reconciliation from `createComputerUseApi`; preserve serialized settings changes and failed-opt-in rollback.
- [ ] Preserve the existing bundled-bin PATH injection. Have the Skill use descriptor `binaryPath` for actual calls so a login-shell PATH cannot select another installed driver. No system-driver fallback or global PATH-policy rewrite.
- [ ] Rerun focused suites plus `pnpm exec vitest run tests/unit/computer-use-settings.test.ts tests/unit/main-quit-lifecycle.test.ts tests/unit/cua-sdk.test.ts`.
- [ ] Review checkpoint: CLI endpoint publication with unchanged host ownership and UI semantics.

## Task 3: Vendor The Official Skill With Host Guidance

**Files:**
- Replace `resources/skills/computer-use/SKILL.md` with the ClawX entrypoint.
- Vendor `UPSTREAM-SKILL.md`, `MACOS.md`, `WINDOWS.md`, `LINUX.md`, `BROWSER.md`, `RECORDING.md`, `EMBEDDING.md`, and `README.md` under `resources/skills/computer-use/`.
- Add `resources/skills/computer-use/LICENSE.md` and `UPSTREAM.json` with exact source commit/tag, paths, filename mapping, and file hashes.
- Modify `electron/utils/skill-config.ts` and `tests/unit/builtin-computer-use-skill.test.ts`.

**Interfaces:** Keep the picker command `/computer-use`. Official native-operation guidance plus a small host-specific bootstrap and precedence section, explicitly attributed to the 0.21.0 accompanying Skill.

- [ ] Add failing tests for offline installation, source/version hashes, license inclusion, new Skill discovery, relative reference resolution, and no stale bundled Skill.
- [ ] Run `pnpm exec vitest run tests/unit/builtin-computer-use-skill.test.ts tests/unit/cua-cli-contract.test.ts` and verify expected failures.
- [ ] Vendor the fixed source, retaining notices. Rename only the upstream entrypoint so discovery registers one Skill. Map its out-of-directory action-result reference to the pinned online reference in the integration instructions.
- [ ] Write the concise entrypoint: locate the live descriptor at task start; invoke its absolute binary with explicit socket; use a unique session; invalidate observations and reread the descriptor after restart/unavailability. Do not require a separate model-tool round trip to rediscover the endpoint before every action.
- [ ] Override upstream installation, `serve`, daemon `stop`, MCP setup, updates, standalone permission commands, autostart, and permission-policy changes. User controls ClawX opt-in and OS permissions. `end_session` is permitted cleanup; it is not daemon shutdown.
- [ ] Route normal tasks through official window/AX/menu guidance; load platform documentation on demand and browser/recording references only for matching tasks. Do not promise all menu operations preserve foreground focus. Do not adopt newer browser cleanup guarantees.
- [ ] Document image-capable read, fresh workspace-scoped files, coordinate scaling, bounded tree output, effect/verification interpretation, unknown-completion handling, and consequential-action confirmation. Do not pipe screenshot base64 into model context.
- [ ] Retain the built-in slug `computer-use` and replace the known old bundled instruction during installation. Preserve unrelated user content; no general Skill updater or new slug.
- [ ] Rerun focused tests. Review checkpoint: official Skill reuse with an explicit, inspectable ClawX-specific delta.

## Task 4: Retire The Custom Adapter

**Files:**
- Remove `resources/openclaw-plugins/clawx-cua-computer/` and `tests/unit/clawx-cua-plugin.test.ts` after replacing relevant coverage.
- Modify `electron/utils/plugin-install.ts`, `electron/utils/openclaw-auth.ts`, `tests/unit/plugin-install.test.ts`, and `tests/unit/openclaw-auth.test.ts`.
- Review existing CUA task specs under `harness/specs/tasks/` so active validation does not require deleted tests or superseded MCP behavior.

**Interfaces:** No installed or registered ClawX `computer` tool; new operations use ordinary `exec` and `read`. Keep historical chat presentation and independent vision-model metadata fixes.

- [ ] Add failing tests proving CUA plugin install/trust repair/policy reconciliation no longer runs, while unrelated plugins and model input metadata remain unchanged.
- [ ] Run `pnpm exec vitest run tests/unit/plugin-install.test.ts tests/unit/openclaw-auth.test.ts` and verify expected failures.
- [ ] Delete the obsolete adapter and its registration/policy hooks. Do not remove the SDK, native unpack rules, binary downloader, or existing host quit handling.
- [ ] Retire the internal test installation explicitly while Gateway is stopped: old `computer-use` Skill, known ClawX plugin mirror, exact plugin install records (use existing SQLite helper), and old descriptor. Keep this a targeted development cleanup, not a startup migration framework. Do not follow links outside known paths or kill unrelated driver processes.
- [ ] Preserve unrelated config and plugin policy. Never turn a sole-CUA restrictive allowlist into absent/empty unrestricted policy silently; report this fixture for explicit policy reset rather than inventing a compatibility mechanism.
- [ ] Keep the `computer` chat presentation for historical transcripts; do not rewrite old conversations. Preserve provider vision inference and explicit text-only declarations.
- [ ] Rerun focused suites and `pnpm exec vitest run tests/unit/provider-model-capabilities.test.ts tests/unit/plugin-install-index.test.ts`.
- [ ] Review checkpoint: no old model-facing path or automatic plugin resurrection; no production migration subsystem.

## Task 5: Validate Product And Packaged CLI Behavior

**Files:**
- Modify `src/pages/ComputerUse/index.tsx` only where wording/behavior requires it; retain management routing and developer gating.
- Modify `shared/i18n/locales/{en,zh,ja,ru}/common.json`, `tests/e2e/computer-use.spec.ts`, `tests/e2e/computer-use-skill.spec.ts`, and `tests/e2e/developer-mode.spec.ts`.
- Add `tests/e2e/computer-use-cli.spec.ts` with synthetic command/image fixtures; apply the existing exclusive policy if later native OS-global cases are added.
- Review `scripts/download-cua-driver.mjs`, `tests/unit/cua-driver-artifacts.test.ts`, and `scripts/after-pack.cjs`; change Windows executable treatment only when demonstrated necessary.

**Interfaces:** Existing host-api status and permission management; executable/read image results through the real local OpenClaw tool path. No native actions in default E2E.

- [ ] Add failing E2E assertions for `/computer-use` installation/selection with CLI guidance, no old plugin, no implicit enablement, unchanged permission gating, and CLI/read transcript behavior.
- [ ] Run focused Electron E2E to establish failures, then update UI strings and fixtures. Document developer-mode access in Skill guidance.
- [ ] Exercise the actual OpenClaw exec/read path with a fake CLI and synthetic PNG: paths with spaces, JSON and Unicode, missing descriptor/driver, stale socket, zero-exit error payload, failed image write, image resizing, and workspace-only restrictions.
- [ ] Confirm image-bearing tool results reach a mocked vision-provider request, not only persisted chat history. Preserve text-only model behavior.
- [ ] On packaged macOS and Windows, verify binary/version resolution, stdout/stderr, waiting, cancellation, and PowerShell JSON passing. Windows currently patches the binary to GUI subsystem for SDK launch; do not remove that patch speculatively or assume interactive behavior equals piped execution.
- [ ] Preserve current uv-first binary preparation order: uv's existing downloader removes the shared target directory. Do not introduce unrelated downloader refactoring in this task.
- [ ] Review checkpoint: packaged CLI protocol and image feedback work without real desktop manipulation.

## Task 6: Native Acceptance And Documentation

**Files:**
- Update `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, both Computer Use reference documents, and the new task spec.
- Record native acceptance evidence and performance measurements in `harness/reference/computer-use-cli-validation.md`.

**Interfaces:** Explicitly authorized isolated desktop test session; no live input during routine unit/E2E runs.

- [ ] Before desktop testing, obtain user permission for the exact app/task and ensure no sensitive windows are exposed.
- [ ] Prove named-session continuity across separate exec calls: window observation, token-targeted action, verification, session end; test host disable/restart and stale references without replaying input.
- [ ] Validate pixel fallback against the actual model-visible resized image, plus permission attribution in a packaged signed host. Record unsupported elevated/OS-protected targets honestly.
- [ ] Compare the same model/settings/tasks between the old adapter baseline and native CLI: completion success, model round trips, total latency, driver latency, image count/bytes, and failed/repeated actions. Keep a transport-only comparison separate from semantic-window improvements when a baseline is available.
- [ ] Document that cancellation of exec cannot undo an admitted native action and that Skill rules are not a sandbox against arbitrary shell access. Do not claim a new global serialization or emergency-stop guarantee.
- [ ] Update documentation for `/computer-use`, Main-owned opt-in, supported platforms, official 0.21.0 Skill provenance, screenshot privacy, and actual failure recovery.
- [ ] Run `pnpm run lint:check`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build:vite`.
- [ ] Run `pnpm exec playwright test tests/e2e/computer-use.spec.ts tests/e2e/computer-use-skill.spec.ts tests/e2e/computer-use-cli.spec.ts tests/e2e/developer-mode.spec.ts` after the build.
- [ ] Run `pnpm harness validate --spec harness/specs/tasks/cua-driver-cli.md`, `pnpm harness run --spec harness/specs/tasks/cua-driver-cli.md`, `pnpm run harness:ci`, `pnpm run comms:replay`, and `pnpm run comms:compare`.
- [ ] Review final diff and request code review. Report missing Windows/native/model validation as incomplete acceptance, not a passing result. Commit only if requested.

## Sources And Research Verification

- Official OpenClaw adapter: https://github.com/openclaw/openclaw/tree/f74837eec91453eb26ec18de94f907a0698721e7/extensions/cua-computer
- Pinned CUA Skill: https://github.com/trycua/cua/tree/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/Skills/cua-driver
- Pinned CLI parser/dispatch: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/cua-driver/src/cli.rs
- Pinned embedding guide: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md
- Pinned license: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/LICENSE.md
- Local SDK type: `node_modules/@trycua/cua-driver/dist/native/cua_driver_sdk.d.ts`, `EmbeddedDriverConnection`.
- Local OpenClaw image path: `node_modules/openclaw/dist/sessions-D8qGY7uC.js`, `openclaw-tools-KulZ1cdH.js`, `tool-images-Rr7Njheg.js`, and `openai-transport-stream-B0WkSqXp.js`.
- During planning, executed only bundled `--version`, `describe get_window_state`, and `describe verify_state`, with `CUA_DRIVER_RS_TELEMETRY_ENABLED=false`. Binary reports 0.21.0 and the inspected schemas match the relevant pinned contract. No daemon, screenshot, permissions, or input test was run.

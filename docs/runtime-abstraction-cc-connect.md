# ClawX Runtime Abstraction and cc-connect Migration Plan

## Background

ClawX currently treats OpenClaw Gateway as the only runtime. That keeps the renderer and host services simple, but it also means OpenClaw runtime instability directly affects chat, sessions, channels, cron, diagnostics, and packaging. ClawX needs a replaceable runtime layer so OpenClaw can remain the default and rollback path while cc-connect can be evaluated as an optional runtime.

## Goals

- Support `openclaw` and `cc-connect` behind one runtime contract.
- Keep `openclaw` as the default runtime.
- Add a Settings runtime selector with status, managed config path, and capability visibility.
- Run cc-connect from ClawX-managed app data, not the user's `~/.cc-connect`.
- Bundle cc-connect and native OpenAI Codex CLI binaries into packaged app resources so runtime startup does not require global installs, PATH binaries, or network downloads.
- Keep existing renderer entry points through `host-api` and the legacy `gateway:*` compatibility layer.

## Design Principles

1. **One product surface, multiple runtime implementations.**
   Renderer code should continue to behave as if ClawX has one chat/session/
   cron/skills/provider surface. Runtime differences belong behind Host API
   services and provider capability metadata.
2. **Main process owns runtime behavior.**
   Electron main owns runtime selection, process lifecycle, bridge credentials,
   local ports, managed paths, and transport policy. Renderer code should not
   implement protocol selection or runtime-specific HTTP calls.
3. **Shared contracts must expose degraded states honestly.**
   A capability group such as `cron` or `channels` is not enough. The contract
   must say which operations are native, degraded, or unsupported so UI and
   tests do not accidentally claim OpenClaw parity.
4. **cc-connect is evaluated through Codex first.**
   ClawX prepares a bundled Codex binary, managed `CODEX_HOME`, provider
   profile, project workspace, and skills mirror for cc-connect. cc-connect
   still owns runtime execution, chat delivery, session stores, and tool events.
5. **Rollback is a first-class design constraint.**
   OpenClaw remains the default runtime and release rollback path. Switching
   runtimes must not corrupt OpenClaw config, user workspaces, or cc-connect
   managed state.
6. **Validation separates "works now" from "replacement-ready".**
   Real OAuth smoke can prove cc-connect startup and core workflows. It does
   not automatically prove live channel parity, every cron mode, generated
   artifact delivery, or release packaging across platforms.

## Non-goals

- The first cc-connect release does not need strict parity for OpenClaw Skills or ClawHub integration.
- The first cc-connect release does not need to repair OpenClaw internal configuration.
- This plan does not remove `GatewayManager`; it wraps it as the OpenClaw provider first.

## cc-connect Facts

- `cc-connect@1.3.2` currently ships an npm package containing a CLI wrapper, `install.js`, `run.js`, `package.json`, and README.
- `install.js` downloads a GitHub or Gitee release binary into `node_modules/cc-connect/bin/`.
- Therefore ClawX packaging cannot rely on declaring the npm dependency alone. The build must explicitly download, verify, and copy the target platform binary into Electron `extraResources`.
- Runtime startup must execute the bundled resource binary in packaged builds.

## Capability Matrix

| Capability | OpenClaw | cc-connect first version | Behavior when unsupported |
| --- | --- | --- | --- |
| Chat | Supported, including abort | Supported through cc-connect BridgePlatform; cc-connect invokes Codex; text/streaming, tool/command/patch events, and image/file/audio bridge packets are mapped into the shared chat/runtime message model; abort marks the bridge run aborted and restarts cc-connect to terminate in-flight Codex work | Runtime `aborted` event plus restart-based cancellation |
| Sessions | Supported | Supported through cc-connect bridge/session store; real OAuth smoke covers restart reload and delete semantics for the main agent session | Empty/stable response or unsupported |
| History | Supported | Supported through cc-connect bridge/session store; token/cost history has deterministic field-shape coverage and still needs live cost-value evidence from real credential runs | Empty/stable response or unsupported |
| Providers/models | Supported | OpenAI API key, OpenAI OAuth/Codex, OpenAI-compatible Responses Custom providers, and Ollama supported through Codex launch profile | Chat Completions Custom providers and unsupported vendors return stable errors and do not mutate OpenClaw config |
| Channels | Supported | cc-connect platform bridges with runtime-routed status probes from Management API project detail; config changes reload through Management API with restart fallback | Capability-aware degradation |
| Cron | Supported | Management API-backed list/create/update/delete/toggle; prompt-job run falls back through BridgePlatform when the local cc-connect exec endpoint is unavailable; adapter preserves project/session, exec/work_dir, session_mode, and timeout_mins fields | Stable unsupported for exec jobs when manual exec is not exposed |
| Logs/status | Supported | Supported through process logs/status | Runtime manager log/status surface |
| Skills | Supported | Enabled local skills mirrored into managed Codex home; OpenClaw Skills/ClawHub parity is not strict | OpenClaw-only controls hidden or disabled |
| Doctor | Supported | `doctor user-isolation` supported; fix unavailable in 1.3.2 | Runtime-aware doctor output; fix disabled for cc-connect |

## Replacement Readiness Gap Register

This section tracks the gap between "cc-connect can run ClawX chat" and
"cc-connect + Codex can replace OpenClaw for core ClawX workflows." It is a
living backlog for the next delivery phases.

### Current verified baseline

- Local dev can bundle and verify `cc-connect@1.3.2` and `@openai/codex@0.137.0`.
- Mock bridge E2E covers Settings runtime switching, managed config creation,
  cc-connect BridgePlatform chat, OpenAI OAuth profile materialization, sessions/history,
  channels, cron, and skills sync behavior.
- cc-connect session listing now carries transcript-derived `derivedTitle` and
  `lastMessagePreview` alongside channel/user `displayName`, so the shared
  Sessions surface can refresh sidebar labels from the same runtime API that
  OpenClaw uses.
- Real bundle smoke starts the packaged development `cc-connect` and `codex`
  binaries without replacing them with mock executables.
- Real bundle smoke now validates cc-connect Management API channel config
  reload and project platform status with a local LINE webhook platform,
  proving reload keeps the same cc-connect pid/port and ClawX reads live
  `connected`/`running` status without requiring external channel credentials.
- Real bundle smoke also validates Management API cron create/list/update/toggle/
  delete for a non-main agent project without model credentials, and runs
  `cc-connect doctor user-isolation` through the Host API against the managed
  config.
- Opt-in real OAuth E2E verifies ClawX chat delivery, session summary/history,
  direct cross-agent research chat with title/preview summary parity, managed
  project workspace isolation, token usage history for main and research
  `agent:*` sessions, a real Codex file-writing tool turn that writes into the
  bound research workspace and surfaces tool evidence in cc-connect history,
  local skill mirroring, main-agent prompt cron create/list/run/toggle/delete,
  and cross-agent research cron create/list/run/delete through real cc-connect,
  real bundled Codex, and a ClawX-managed `CODEX_HOME/auth.json` imported only
  from an explicit `CLAWX_REAL_CODEX_AUTH_JSON` source with
  `auth_mode: chatgpt`.
- Provider Host API exposes cc-connect Codex OAuth status, explicit import from
  the user's local Codex OAuth file, and logout/secret cleanup without exposing
  OAuth token values to the renderer.
- Settings > AI Providers exposes the same cc-connect Codex OAuth lifecycle on
  OpenAI OAuth account cards: status refresh, managed path copy/open, explicit
  local import, relogin, manual callback submission, and logout.
- Runtime diagnostics are now runtime-aware. The diagnostics snapshot includes
  active runtime status, operation-level capabilities, cc-connect managed paths,
  Codex OAuth status, sanitized provider profile data, and the active runtime log
  tail, bundle manifests/version command output, Management API health, and
  safe cron summaries with known cron validation gaps;
  Settings exposes a copyable runtime diagnostics bundle. Real bundled-runtime
  smoke now asserts that the diagnostics Host API reports cc-connect runtime
  status, native/unsupported operation capabilities, managed paths, binary
  version probes, provider profile summary, Management API health, and cron
  summary metadata without exposing the management token, cron prompt, cron exec
  command, or runtime error text.
- File/media Host APIs now use runtime-aware media roots. OpenClaw staging and
  outgoing media records remain under `~/.openclaw/media`, while cc-connect
  staging and outgoing record resolution use ClawX-managed
  `userData/runtimes/cc-connect/media` with OpenClaw fallback for historical
  messages.
- The cc-connect BridgePlatform adapter now declares `image`, `file`, and
  `audio` capabilities and converts base64/path/url media packets into
  renderer-visible `_attachedFiles` messages stored under the cc-connect
  managed media directory. The local verifier exposes this as
  `bridge-media-packets-local-diagnostics`, backed by deterministic adapter
  coverage for image preview preservation plus file/audio preview suppression.
- The cc-connect BridgePlatform adapter also declares tool/command/patch event
  support. Protocol-level fixtures map `tool_call`, `tool_result`,
  `command_output`, and `patch_completed` packets into the shared runtime graph,
  and file-editing tool calls are persisted as `toolCall` content blocks so the
  generated-files panel can use the same extraction path as OpenClaw/Codex
  transcripts.
- `bridge-rich-packets-local-diagnostics` covers the local BridgePlatform
  adapter behavior for `card`, `buttons`, `preview_start`, `update_message`,
  `delete_message`, and typing packets. This proves stable protocol handling
  inside the shared runtime model, but it is still not real upstream rich packet
  delivery evidence from a live cc-connect session.
- Real Codex CLI transcript reconciliation now recognizes both
  `function_call`/`function_call_output` and
  `custom_tool_call`/`custom_tool_call_output`, which are emitted by bundled
  Codex 0.137 for patch/edit tools. Tool evidence shown in ClawX history must
  therefore come from cc-connect-owned runs and linked managed Codex
  transcripts, not from direct GUI-to-Codex calls.
- The generated-files extraction path now understands Codex `apply_patch`
  tool calls. The real OAuth smoke creates a file through GUI chat, verifies
  the file under the ClawX-managed workspace, and asserts the generated-file
  card is visible in the chat UI.

### P0 gaps before treating cc-connect as a real OpenClaw replacement

1. Capability accuracy.
   - `RuntimeStatus.operationCapabilities` now exposes operation-level support
     such as `chat.send`, `chat.abort`, `doctor.run`, `doctor.fix`,
     `channels.status`, `channels.connect`, `cron.update`, and `cron.toggle`.
   - Settings consumes this metadata and shows degraded/native/unsupported
     operation gaps instead of implying full parity from one top-level boolean.
   - Cron and channel runtime actions now consult the operation contract before
     invoking runtime-specific actions. Cron list/create/update/delete/toggle/run
     and channel connect/disconnect/delete share the same renderer guard used by
     Settings Doctor Fix.
   - Remaining work is to expand real-runtime coverage for operation-specific
     edge cases rather than top-level capability visibility.
2. In-app Codex OAuth lifecycle.
   - Host API now supports Codex OAuth status, explicit import from a
     user-selected Codex `auth.json`, and logout of the managed cc-connect Codex
     auth plus stored OAuth secret.
   - Settings UI now exposes status, managed path diagnostics, explicit import,
     relogin/manual callback, and logout for OpenAI OAuth accounts.
   - The local verifier now rejects explicit Codex auth files unless
     `tokens.access_token`, `tokens.account_id`, `tokens.id_token`, and
     `tokens.refresh_token` are all non-empty strings and the sanitized expiry
     summary is not clearly expired.
   - ClawX still needs expired-token recovery and a gated live relogin test that
     exercises the external browser OAuth path end to end.
   - The flow keeps runtime tokens inside app userData and only imports
     user `~/.codex` when the user or test explicitly requests migration.
3. Chat stop/abort parity.
   - OpenClaw has a first-class abort path. cc-connect BridgePlatform does not
     currently expose a stable single-run abort RPC.
   - ClawX now terminates the active bridge run locally, emits the same
     `aborted` runtime event shape that the renderer expects, ignores late
     bridge replies for that run, and restarts cc-connect to terminate in-flight
     Codex work.
   - This is complete for the current abstraction surface, but it remains
     coarser than an upstream cc-connect single-run cancellation primitive.
4. Doctor parity.
   - `cc-connect --help` does not list doctor, but `cc-connect doctor` reveals a
     hidden `user-isolation` subcommand.
   - ClawX currently maps `doctor.run` to `doctor user-isolation` and returns a
     stable unsupported result for `doctor.fix`.
   - Because cc-connect doctor is not the same feature as OpenClaw Doctor, the
     UI and contract must distinguish cc-connect isolation diagnostics, Codex
     diagnostics, and OpenClaw config repair. The runtime diagnostics snapshot
     now exposes the cc-connect side of this evidence. OpenClaw Doctor Fix
     remains OpenClaw-specific and is not required for the first cc-connect
     replacement milestone; Codex expired-auth repair remains separate work.
5. Developer-only runtime gate.
   - The renderer settings store currently forces `runtimeKind` back to
     `openclaw` when Developer Mode is not unlocked.
   - This is an accepted current product constraint: cc-connect stays behind
     Developer Mode while replacement readiness is still being proven. Do not
     treat the gate as an implementation defect for the current milestone.
   - Removing the gate is a later release decision, not part of the runtime
     abstraction work needed to make cc-connect technically usable.

### P1 gaps for core workflow equivalence

1. Provider/model conversion matrix.
   - Current conversion covers OpenAI API key, OpenAI OAuth/Codex, Ollama,
     OpenAI-compatible Responses custom providers, and ByteDance ModelHub
     Responses specifics.
   - The minimum verification set is OpenAI API key and Codex OAuth in
     cc-connect mode, including startup profile materialization, secret
     availability, model selection, logout/import status, and runtime restart
     after switching providers.
   - Local deterministic E2E covers both OpenAI API key and OAuth profile
     materialization. Real network validation is intentionally opt-in through
     `test:e2e:cc-connect:real-openai-api-key` and
     `test:e2e:cc-connect:real-comprehensive`.
   - Missing OpenAI API-key credentials now produce an unsupported provider
     profile before chat dispatch rather than starting cc-connect with an empty
     API-key provider. Runtime provider unit coverage also verifies that
     provider/model sync while cc-connect is running rewrites managed
     `config.toml`, restarts cc-connect, and launches the new process with the
     updated provider environment. The matrix still needs production validation
     for unsupported vendor UX, Chat Completions custom providers, provider
     default-model fallback, reasoning effort, `env_http_headers`, and real UI
     model switching after runtime start.
   - cc-connect also has provider CLI/Web Admin concepts such as global
     providers, provider presets, project provider activation, and project model
     updates. ClawX currently writes a managed Codex launch profile instead of
     fully adopting the cc-connect provider management API, so this must be an
     explicit product decision.
2. Session/history fidelity.
   - The bridge adapter combines in-memory ClawX messages and cc-connect
     persisted session stores. It must not read user-global Codex transcript
     JSONL files directly; missing chat history must be fixed in cc-connect
     BridgePlatform or cc-connect session store output.
   - Gated real OAuth comprehensive smoke now validates main-agent and
     cross-agent session summary/history, runtime restart reload, delete
     semantics, project workspace isolation, and transcript-derived
     title/preview parity through real cc-connect plus bundled Codex.
   - Named cc-connect sessions now keep explicit store names before falling
     back to first-user-message titles. History loading merges all matching
     cc-connect session stores for the requested `agent:*`/`clawx:*` session key
     before applying limits, so stale store ordering cannot hide newer turns.
     Session listing also exposes additional agent named sessions and orphan
     session-store records as stable `agent:<agent>:<storeSessionId>` keys while
     keeping channel conversations on their original channel keys. Session
     deletion removes active, named, and direct agent session ids for that key.
     Session rename is now runtime-routed for cc-connect: it updates cc-connect
     owned session stores and supplemental labels instead of mutating OpenClaw
     `sessions.json`, and active/base-session rename does not rename unrelated
     named or orphan store sessions.
     Remaining parity work is OpenClaw sidebar edge cases and broader
     real-runtime history shapes from live channels.
   - Token/cost history now reads cc-connect-owned session store usage records
     under ClawX userData. It may also read `token_count` events from the
     ClawX-managed cc-connect `CODEX_HOME` when they are linked from
     cc-connect session stores by `agent_session_id`, or when transcript
     `session_meta.cwd` matches a configured cc-connect project workspace or
     the ClawX-managed `runtimes/cc-connect/workspaces/<agent>` tree while the
     session-store mapping is still lagging. It must not read the user's global
     `~/.codex` transcripts or any non-managed/unattributed Codex state.
     Managed Codex `token_count` transcript usage is covered by unit and
     Electron IPC E2E tests, including negative cases for user-global and
     unattributed managed transcripts. The token usage API now accepts a
     `runtimeKind` filter; Host API, unified request, and legacy IPC entry
     points default omitted filters to the active runtime so cc-connect mode
     presents only cc-connect-owned usage unless a diagnostic caller explicitly
     requests another runtime. Deterministic tests cover common cost field
     shapes such as top-level `total_cost_usd` and nested `cost.total_usd`.
     Remaining work is live OAuth/API-key cost-value evidence before the
     Dashboard can claim full parity.
3. Tool events and artifacts.
   - The bridge currently handles text replies, streaming text, preview updates,
     cards, buttons, errors, and image/file/audio media packets. Base64 media is
     persisted under the cc-connect managed media directory and surfaced through
     the shared `_attachedFiles` renderer model.
   - The bridge maps tool/command/patch packets into shared runtime events and
     stores file-editing tool calls as assistant `toolCall` content blocks, so
     execution graph and generated-file extraction no longer depend on
     OpenClaw-specific event names.
   - Gated real OAuth smoke now also forces a real Codex file-writing tool turn
     in the bound research workspace and verifies that cc-connect history
     exposes tool evidence for that session.
   - Remaining work is to validate artifact panel behavior, richer generated
     artifact metadata, and image/file send-back from real cc-connect bridge
     packets or session stores rather than only protocol-level fixtures.
4. Channel lifecycle.
   - Channel status is runtime-routed and ClawX materializes configured
     OpenClaw channel accounts into cc-connect project platform blocks.
   - cc-connect does not expose a documented per-platform connect/disconnect
     endpoint in the pinned `1.3.2` binary. ClawX therefore treats channel
     lifecycle as config projection plus Management API `/reload`, with
     restart fallback only when reload fails.
   - `channels.status` now reads cc-connect Management API
     `/projects/{name}` detail and maps platform `connected`/`running` back to
     ClawX channel accounts instead of deriving status from process state alone.
     Multiple same-type platforms in one cc-connect project are matched back to
     ClawX accounts by config/status order so Feishu/Lark accounts are not
     collapsed into one `platformType` status.
   - Feishu/Lark account projection covers both Lark and Feishu China domains,
     required app credentials, channel sharing options, default account status,
     and bound-agent project placement.
   - The current real Feishu/Lark smoke validates runtime config projection,
     live project platform `connected`/`running` status, connect/disconnect
     reload, and delete cleanup when real app credentials are supplied. It does
     not prove inbound Feishu message delivery through a live tenant chat.
   - Each supported platform requires field mapping and real credential/status
     smoke tests, especially live Feishu callback/login status, Weixin/WeCom,
     Discord, Slack, Telegram, QQ, and LINE.
5. Cron and heartbeat.
   - cc-connect exposes CLI and Management API support for cron add/list/edit,
     delete, and immediate execution.
   - ClawX maps create/update/delete/toggle through Management API. In the
     pinned local `cc-connect@1.3.2` binary, `POST /api/v1/cron/{id}/exec`
     returns `DELETE or PATCH only` even though upstream docs list it. ClawX
     therefore falls back to BridgePlatform delivery for prompt jobs and keeps
     exec jobs explicitly unsupported for manual run in this version.
   - Cron create/list/update/run now preserves selected ClawX agent routing by
     mapping `agent:<id>:main` to cc-connect `project = "clawx-<id>"`.
     Prompt-job manual run falls back through BridgePlatform with the job's
     stored ClawX bridge session key. Native scheduled cron execution is
     cc-connect platform-scoped: external announce delivery uses
     `<channel>:<target>` and local exec cron uses the ClawX placeholder LINE
     platform session `line:clawx-scheduled-cron`, because cc-connect 1.3.2
     does not resolve `clawx:*` or `bridge:*` session keys inside its scheduler.
     The gated real OAuth comprehensive smoke validates a `research` agent cron
     round trip through real cc-connect plus bundled Codex.
   - The adapter now also passes through cc-connect cron `exec`, `work_dir`,
     `session_mode`, and `timeout_mins` fields when supplied by Host API or
     future UI payloads. ClawX contract value `sessionMode: "continue"` maps
     to cc-connect `session_mode = "reuse"` on write, while cc-connect `reuse`
     maps back to ClawX `continue` on read.
   - Disabled manual run is covered by unit tests: ClawX refuses fallback
     BridgePlatform delivery when the cc-connect cron job is disabled.
   - Basic `delivery.mode` to cc-connect `silent` mapping is covered by
     Management API unit tests. cc-connect `mute` is exposed on the shared Cron
     contract, written with a create-after-PATCH flow because the pinned
     `cc-connect@1.3.2` create endpoint does not persist or echo it directly,
     and validated against the real bundled binary. Explicit external delivery
     payloads are now passed through as structured `delivery` fields only when
     channel and target are both supplied, and read back into the shared Cron
     `delivery`/`target` view. The opt-in scheduled cron smoke creates an
     every-minute exec cron through the Management API and verifies the real
     cc-connect scheduler writes the expected marker through the configured
     `work_dir`. Because cc-connect 1.3.2 does not natively deliver scheduled
     prompt runs to the ClawX bridge platform, `CcConnectRuntimeProvider` also
     runs a conservative prompt cron fallback while the runtime is healthy: it
     polls cc-connect cron metadata, ignores exec/disabled jobs, dedupes by cron
     slot, and sends due prompt jobs back through the same BridgePlatform path
     used by GUI chat. Project heartbeat, live tenant channel delivery targets,
     and actual muted scheduled-delivery behavior are not yet covered by ClawX
     acceptance.
6. Skills and commands.
   - ClawX mirrors enabled local skills into the managed Codex home.
   - The Skills page now resolves a runtime-aware target. OpenClaw mode opens
     the source skills directory, while cc-connect mode displays and opens the
     managed Codex skills mirror root plus manifest path through Host API.
   - cc-connect also has slash-command/custom-command behavior and setup prompts
     such as `/bind setup` or `/cron setup` for attachment send-back. These are
     not yet modeled in ClawX's runtime capability contract.
7. Logs and diagnostics.
   - `listLogs` returns managed config and paths with redaction, and
     `diagnostics.gatewaySnapshot()` now includes active runtime status,
     operation capabilities, cc-connect managed paths, Codex OAuth summary,
     sanitized provider profile data, bundle manifests/version command output,
     Management API health, safe cron summaries with known cron validation
     gaps, and runtime log tail.
   - Remaining replacement-readiness work is to add Codex doctor output and
     last structured runtime error classification into the same snapshot.
8. Lifecycle and port ownership.
   - cc-connect Management API and BridgePlatform prefer the documented local
     ports `9820` and `9810`, but ClawX now probes localhost before startup and
     writes fallback ports into the managed config when either default is busy.
     Runtime status, Control UI, diagnostics, and Management API calls all use
     the selected management port.
   - Unexpected cc-connect crashes now close the bridge, stop session polling,
     surface an error status, and schedule a bounded automatic restart instead
     of leaving the runtime permanently down.
   - Runtime stop/restart now starts cc-connect in its own process group on
     non-Windows platforms and terminates the process tree, so Codex child
     processes launched by cc-connect are cleaned up during runtime switching.
   - App quit already routes through `before-quit -> runtimeManager.stop()`,
     so the same cc-connect process-tree cleanup path is used during shutdown.
   - Real bundled-runtime Electron smoke now verifies app quit and rollback to
     OpenClaw close the cc-connect process, release the selected ports, and
     leave no process command referencing the isolated cc-connect runtime dir.
   - macOS dir-packaged smoke now starts `release/mac-arm64/ClawX.app` directly,
     verifies `Contents/Resources/cc-connect` and `Contents/Resources/codex`,
     starts cc-connect through the packaged resolver path, validates packaged
     Host API cron create/list/update/toggle/delete plus `cc-connect doctor
     user-isolation`, verifies rollback to OpenClaw releases the packaged
     cc-connect process tree and ports, and checks cleanup after app quit.
   - The same packaged smoke supports `--real-oauth=1`; with explicit
     `CLAWX_REAL_CODEX_AUTH_JSON`, this copies a local Codex `auth.json` into
     isolated packaged userData, verifies the public provider profile does not
     expose token material, and sends a real GUI chat through packaged
     cc-connect plus bundled Codex.
   - Remaining release-readiness work is notarized dmg/zip validation and
     equivalent Windows/Linux packaged-runtime smoke coverage.
9. Packaged app validation.
   - Bundle verification is not the same as packaged app verification.
   - macOS dir-packaged smoke now validates the final
     `.app/Contents/Resources/cc-connect` and
     `.app/Contents/Resources/codex` executables, managed config `cmd`, runtime
     startup, packaged cron Management API operations, packaged doctor
     execution, rollback cleanup, quit cleanup, and opt-in packaged real OAuth
     GUI chat.
   - Remaining release-readiness work is notarized dmg/zip validation plus
     Windows and Linux resource-path, executable, startup, and cleanup smoke
     checks.
10. Documentation and i18n.
   - Some user-facing text still says OpenClaw Doctor even when the active
     runtime is cc-connect.
   - README files describe cc-connect functionality optimistically; they need to
     distinguish experimental, degraded, and replacement-ready states.
11. Product-wide OpenClaw assumptions.
   - Setup still validates the embedded OpenClaw package as the runtime
     prerequisite. A cc-connect replacement track needs either a runtime-neutral
     setup check or an explicit "OpenClaw runtime installed for rollback" label.
   - Skills UI now obtains its source and runtime mirror directories through
     `hostApi.skills.target()`, so cc-connect mode exposes the managed Codex
     skills root instead of opening the OpenClaw source directory. The remaining
     Skills gap is slash/custom-command behavior and setup prompts.
   - File/media staging and outgoing record lookup are runtime-aware for
     OpenClaw and cc-connect. Bridge tool/command/patch packets are translated
     into shared runtime events and generated-file `toolCall` blocks. Real
     OAuth now validates `apply_patch` generated-file card rendering from GUI
     chat. Adapter-level coverage validates BridgePlatform image/file/audio
     packet mapping into cc-connect managed media plus local
     card/button/preview/update/delete packet handling. Remaining work is
     validating real upstream rich card/button/preview/update/delete delivery
     and broader media relay semantics from real cc-connect bridge sessions.
   - Proxy settings intentionally sync to OpenClaw Telegram config today. In
     cc-connect mode, platform proxy behavior needs a cc-connect config sync
     path instead of OpenClaw-only mutation.
   - Dreams and OpenClaw memory doctor routes are correctly OpenClaw-specific,
     but their navigation, fallback errors, and route availability must stay
     runtime-aware.
   - Channel store actions can call `channels.connect`,
     `channels.disconnect`, and `channels.delete` through the runtime provider.
     In cc-connect mode they reload the managed config through the Management
     API and use project platform status for live health. This is stronger than
     a full restart, but still depends on cc-connect's current lack of a
     documented per-platform connect/disconnect endpoint.

### External cc-connect facts to re-check per upgrade

The pinned local binary is the release contract. Upstream `main` documentation
can be newer than `cc-connect@1.3.2`, so every cc-connect version bump must
re-run this audit.

- BridgePlatform is documented as a WebSocket adapter interface with
  authenticated `register`, `message`, `reply`, `reply_stream`, card/button,
  image/file/audio, and preview/delete-message packets.
  Source: <https://github.com/chenhg5/cc-connect/blob/main/docs/bridge-protocol.md>
- Management API is documented as a token-authenticated HTTP API for GUI and
  local management tools, including projects, sessions, providers, models, cron,
  heartbeat, and bridge adapters.
  Source: <https://github.com/chenhg5/cc-connect/blob/main/docs/management-api.md>
- `doctor user-isolation` runs preflight and isolation checks for `run_as_user`
  projects and writes audit output; this is not equivalent to OpenClaw config
  repair.
  Source: <https://github.com/chenhg5/cc-connect/blob/main/docs/usage.md>
- `cc-connect send --image/--file` and the related setup prompts are relevant
  for rich media/card packet delivery beyond generated-file cards, but ClawX
  GUI chat currently needs separate validation before relying on that path.
  Source: <https://github.com/chenhg5/cc-connect/blob/main/docs/usage.md>

### Missing validation conditions

The replacement track must keep these validation conditions visible until they
are covered by automated tests or an explicit release exception.

| Area | Current evidence | Missing condition | Required validation |
| --- | --- | --- | --- |
| Runtime contract | `RuntimeStatus.capabilities` and `operationCapabilities` expose top-level and RPC-level support; Settings, Cron, and channel runtime actions consume operation-level support before invoking unsupported actions | More feature-specific edge cases need real-runtime validation, especially channel platform lifecycle and cron exec/session modes | Unit tests for RPC contract and renderer operation guard, Settings E2E for operation gaps, and real OAuth E2E for native cc-connect paths |
| Chat send | Mock bridge E2E and opt-in real OAuth E2E prove basic chat delivery; bridge unit coverage maps `image`/`file`/`audio` media packets into attached files and maps tool/command/patch packets into shared runtime events plus generated-file `toolCall` blocks; gated real OAuth now verifies a real Codex file-writing tool turn writes into the bound agent workspace, appears as tool evidence in cc-connect history, and renders an `apply_patch` generated-file card in GUI chat | Multi-turn tool-heavy conversations, rich media/card/button/preview/update/delete packet delivery beyond generated-file cards, real media attachments, network retry, model errors, and long-running tasks | Mock bridge event E2E plus gated real Codex prompt suite |
| Chat abort | `chat.abort` is native for cc-connect through bridge abort plus cc-connect restart; unit tests cover aborted events and late reply suppression; the local OpenAI-compatible API-key E2E starts real Electron, real cc-connect, and bundled Codex against a delayed Responses stream, clicks the GUI Stop button, verifies late assistant output is suppressed, and verifies the runtime recovers to `running` | Upstream single-run cancellation primitive beyond restart-based cancellation; real OAuth long-prompt stop remains optional broader evidence | Unit tests plus local OpenAI-compatible API-key Stop E2E |
| Codex OAuth | Gated real OAuth E2E passes with managed `CODEX_HOME/auth.json` imported from explicit `CLAWX_REAL_CODEX_AUTH_JSON`; packaged macOS dir smoke can opt into `--real-oauth=1` to verify packaged GUI chat through managed Codex auth; verifier coverage requires complete non-empty `access_token`/`account_id`/`id_token`/`refresh_token`, rejects clearly expired auth, and reports only sanitized key/expiry metadata; Host API and Settings UI cover status/import/logout/relogin without token disclosure | Expired-token recovery and gated live browser relogin automation | Verifier unit coverage plus Host API unit tests, Provider Settings E2E, and manual/gated real OAuth E2E |
| Doctor | cc-connect `doctor user-isolation` is used; real bundled-runtime smoke runs it through the Host API against managed config | cc-connect hidden doctor contract and Codex doctor/error classification; OpenClaw Doctor Fix is not a first-milestone parity requirement | Unit tests with mock doctor output plus real binary doctor smoke |
| Provider/model | Unit coverage for OpenAI, OAuth, custom Responses, ModelHub, Ollama, unsupported vendors, missing OpenAI API-key credentials, and running-runtime provider/model sync that rewrites managed config plus restart env; `tests/e2e/cc-connect-real-openai-api-key.spec.ts` now includes a credential-free local OpenAI-compatible Responses server smoke that starts real Electron, real cc-connect, and bundled Codex, then verifies OpenAI API-key provider `baseUrl`, model propagation, bearer auth, chat delivery, secret redaction, and `runtimeKind: cc-connect` token usage collection from the same chat; the same spec is also available as an opt-in real OpenAI API key smoke | A real `CLAWX_REAL_OPENAI_API_KEY` or `OPENAI_API_KEY` run must pass before API-key mode has live external OpenAI evidence; Web Admin/provider API alignment, custom header behavior, model defaults, and real UI model switching remain broader gaps | Unit matrix plus local OpenAI-compatible API-key E2E plus gated real `CLAWX_REAL_OPENAI_API_KEY_E2E=1 CLAWX_REAL_OPENAI_API_KEY=... pnpm run test:e2e:cc-connect:real-openai-api-key` |
| Sessions/history | Bridge/session-store unit and E2E coverage; named cc-connect session titles are preserved, and base-key `user_meta` no longer overrides named/orphan agent session display names; agent named/orphan sessions are exposed as stable `agent:<agent>:<storeSessionId>` keys while channel conversations keep their channel keys; OpenClaw-compatible multi-segment keys such as `agent:<agent>:cron:<jobId>` round-trip to cc-connect keys without truncating the suffix; history merges matching records across cc-connect session stores before limiting; delete removes active, named, cron, and direct agent session ids for a key; rename is runtime-routed for cc-connect, persists active/direct/supplemental labels in cc-connect-owned state, and avoids mutating unrelated named/orphan records; gated real OAuth validates main-agent session summary/history, direct cross-agent research chat with title/preview summary parity, restart reload, and delete semantics; token usage reads cc-connect-owned session stores plus managed `CODEX_HOME` `token_count` events attributed by session-store linkage or managed-workspace `session_meta.cwd`, carries `runtimeKind`, parses common cost field variants, and can be filtered by active runtime so cc-connect mode does not show OpenClaw-only rows, with gated OAuth coverage for main and research `agent:*` usage entries | Broader OpenClaw sidebar edge cases, live OAuth/API-key cost-value evidence, and live GUI rename smoke after cc-connect persistence | Real cc-connect session store fixture and gated OAuth restart/delete smoke |
| Channels | Config projection, real bundled-runtime Management API reload/status, Feishu/Lark field mapping, Feishu `cn`/`global` domain aliases, Feishu group/thread/reaction/progress/webhook options, same-project multi-account Feishu/Lark status mapping, and lifecycle reload RPCs are covered; `tests/e2e/cc-connect-real-feishu-channel.spec.ts` is available as opt-in lifecycle and inbound real credential smokes | A real Feishu/Lark sandbox lifecycle run and a sandbox tenant-message inbound marker run must pass before declaring Feishu parity; upstream per-platform connect/disconnect primitives still need live evidence because cc-connect 1.3.2 exposes reload/status but no documented per-platform connect/disconnect command/API | Real local LINE reload/status smoke plus `CLAWX_REAL_FEISHU_E2E=1 pnpm run test:e2e:cc-connect:real-feishu` and `CLAWX_REAL_FEISHU_INBOUND_E2E=1 pnpm run test:e2e:cc-connect:real-feishu-inbound` with sandbox credentials |
| Cron | Management API paths are implemented and mocked; real bundled-runtime smoke validates create/list/update/toggle/delete for a non-main agent project without model credentials, including exec/work_dir/session_mode/timeout field preservation, basic `delivery.mode` -> `silent`, structured external delivery pass-through when channel/target are explicit, cc-connect `mute`, and ClawX `continue` <-> cc-connect `reuse` mapping; an opt-in local scheduled-cron smoke waits for a real cc-connect scheduler tick and proves enabled exec cron delivery without external credentials; cron create/list/update/run preserves agent project/session routing; non-cron ClawX schedules (`at`/`every`) fail with a stable unsupported error instead of silently creating or updating an invalid cc-connect job; gated real OAuth E2E passes main-agent prompt cron create/list/run/toggle/delete and cross-agent research cron create/list/run/delete with BridgePlatform fallback for missing exec endpoint; unit coverage verifies disabled cron jobs cannot be manually run through fallback and scheduled prompt cron fallback dedupes by cron slot | Info endpoint, live tenant-channel scheduled delivery behavior, actual muted scheduled-delivery behavior, heartbeat, and native `at`/`every` parity if cc-connect adds upstream support. Local scheduled prompt delivery through ClawX's BridgePlatform fallback is distinct from live tenant-channel delivery. | Real management API smoke with mock agent project plus gated OAuth prompt cron suite plus opt-in scheduled exec cron smoke plus opt-in scheduled prompt BridgePlatform smoke |
| Skills/commands | Enabled local skills mirror into managed Codex home; Skills page shows and opens the cc-connect Codex mirror target | Command/slash behavior and setup prompts still need runtime capability modeling | Unit sync test plus UI state test |
| Logs/diagnostics | `listLogs` redacts config paths and managed config; diagnostics snapshot includes runtime status, operation capabilities, cc-connect managed paths, Codex OAuth status, sanitized provider profile, bundle manifests/version output, Management API health, safe cron summaries/known gaps, and runtime log tail; real bundled-runtime smoke verifies the Host API diagnostics shape against a running cc-connect process and checks that the management token and cron prompt/exec/error text are not exposed | Codex doctor output and last structured runtime error | Host API test plus Settings diagnostics E2E |
| Lifecycle | Runtime start/stop/restart unit and E2E smoke; unit and real bundle E2E coverage verify fallback ports when `9810`/`9820` are occupied; unit coverage verifies bounded crash restart and stop/restart process-tree cleanup; real bundled-runtime Electron smoke verifies app quit and rollback-to-OpenClaw cleanup; macOS dir-packaged smoke verifies packaged resolver startup, Host API cron/doctor, rollback cleanup, and app quit cleanup | Notarized dmg/zip release smoke and Windows/Linux packaged cleanup smoke | Release-artifact E2E runtime switch/quit smoke |
| Packaging | Bundle verification and real bundle smoke; macOS dir-packaged smoke validates final `.app` resource paths, cc-connect startup, packaged cron Management API operations, packaged doctor execution, and opt-in packaged real OAuth GUI chat | Notarized dmg/zip, Windows/Linux resources, executable permissions, and updater packaging | Release package smoke plus CI package verification |

## Architecture

![ClawX Runtime Architecture](./assets/clawx-runtime-architecture.png)

The architecture is intentionally layered: renderer code sees one ClawX product
surface, the Electron main process owns runtime selection and process lifecycle,
and each runtime provider implements the same Host API capability contracts
underneath. This keeps OpenClaw as the default rollback path while allowing
cc-connect to be evaluated as a Codex-backed runtime without leaking provider
details into React pages.

### Layered Blueprint

1. **Renderer shell**
   - React pages, sidebars, settings, channels, cron, skills, providers, and
     doctor controls remain product UI concerns.
   - Renderer code calls only `host-api` and `api-client`. It does not choose
     transports, call Gateway or cc-connect HTTP endpoints directly, or spawn
     runtime binaries.
   - Runtime-specific UI differences must come from Host API status and
     operation-capability metadata, not from hardcoded runtime checks scattered
     through pages.

2. **Runtime routing**
   - Electron main owns `RuntimeManager`, typed host services, the legacy
     `gateway:*` compatibility API, process lifecycle, config materialization,
     and transport policy.
   - `RuntimeManager` selects the active provider, forwards status/events, and
     exposes a stable RPC/chat/session/history/log surface to host services.
   - `RuntimeProvider` is the internal contract boundary: renderer-facing calls
     stay stable even when OpenClaw and cc-connect implement a capability
     differently underneath.

3. **Shared Host API capability surfaces**
   - `Chat`, `Sessions`, `History`, `Channels`, `Cron`, `Skills`, `Providers`,
     `Models`, `Logs`, `Doctor`, and `Control UI` are horizontal contracts.
   - These surfaces must remain runtime-neutral. A page can ask for
     `cron.run`, `skills.target`, or `providers.oauthStatus`; it should not need
     to know whether that maps to OpenClaw Gateway, cc-connect Management API,
     BridgePlatform, or a managed Codex profile.
   - Each operation carries support metadata (`native`, `degraded`,
     `unsupported`) so the UI can show a real degraded state instead of implying
     full parity from a top-level capability flag.

4. **OpenClaw runtime provider**
   - `OpenClawRuntimeProvider` wraps the existing `GatewayManager` and OpenClaw
     Gateway on `:18789`.
   - It remains the default runtime and release rollback path.
   - OpenClaw-specific features such as OpenClaw Doctor Fix, OpenClaw Skills,
     Dreams, OpenClaw proxy/config repair, and Control UI stay scoped to this
     provider and must not become hidden assumptions in shared host services.

5. **cc-connect runtime provider**
   - `CcConnectRuntimeProvider` runs from ClawX-managed app data, not
     `~/.cc-connect`.
   - It writes managed config/session stores, probes and falls back from the
     default BridgePlatform and Management API ports, starts the process in a
     killable process tree, captures logs, restarts after bounded crashes, and
     cleans up on app quit or runtime rollback.
   - The provider owns cc-connect config projection: app keys, bridge keys,
     channel account to agent-project mapping, operation support metadata,
     skills mirroring, provider profile sync, and runtime-aware media roots.
   - BridgePlatform is the chat/event boundary. Text, streaming deltas,
     image/file/audio packets, tool/command/patch events, and generated-file
     `toolCall` blocks are translated into the same shared renderer shapes used
     by OpenClaw.
   - The verifier records this boundary as `runtime-boundary-bridgeplatform-only`:
     `CcConnectRuntimeProvider` delegates chat send to `CcConnectBridgeAdapter`,
     mock Electron E2E proves GUI chat reaches cc-connect BridgePlatform, and
     Codex appears only as a cc-connect project agent command with managed
     `CODEX_HOME`.
   - The verifier records session parity separately as
     `session-history-parity-local-diagnostics`: cross-agent and named/active
     session keys, title derivation, Host API rename/delete, and channel
     chat/user metadata all resolve against cc-connect-owned session stores.

6. **Validation and replacement-readiness boundary**
   - "Validated now" means cc-connect can start and run Codex-backed ClawX core
     workflows: real bundled startup, managed config, OAuth-backed Codex chat,
     session/history reload and delete, project `work_dir`, skills mirroring,
     prompt cron create/list/run/toggle/delete, app-quit cleanup, rollback
     cleanup, and packaged macOS dir startup.
   - "Known gap" means not yet OpenClaw replacement-ready: live channel platform
     credential lifecycle, exec cron edge cases, rich media/card/button/preview/update/delete
     packet delivery beyond generated-file cards, upstream single-run cancellation,
     expired-token relogin, richer Codex diagnostics, notarized dmg/zip
     validation, and Windows/Linux packaged smoke.

For cc-connect, Codex is the primary integrated backend today:

- ClawX bundles the Codex CLI and manages `CODEX_HOME` per app/runtime.
- Provider profiles map to Codex-supported OpenAI API key, OpenAI OAuth,
  OpenAI-compatible Responses custom providers, ModelHub Responses specifics,
  and Ollama/custom Responses paths.
- Each agent gets an isolated workspace/project profile so chat, cron, and
  channel sessions can be routed by agent/session key.

cc-connect can support additional backend options such as PiAgent and Claude
Code through its backend extension model, but ClawX integration is currently
Codex-focused. Those backends should stay represented as supported extension
paths, not as completed ClawX parity, until provider setup, process lifecycle,
session/history mapping, and UI capability states are implemented.

### Runtime Flow

| Step | Owner | Design rule |
| --- | --- | --- |
| User action | Renderer | Call `host-api`/`api-client` only. No direct IPC, HTTP, or process spawning from pages. |
| API dispatch | Host services | Resolve active runtime through `RuntimeManager`; preserve legacy `gateway:*` compatibility envelopes. |
| Capability decision | Runtime provider | Return operation-level support before performing degraded or unsupported actions. |
| Chat execution | Active provider | OpenClaw uses Gateway; cc-connect uses BridgePlatform and lets cc-connect invoke Codex. ClawX never talks to Codex directly for chat. |
| State persistence | Runtime-owned stores | OpenClaw persists OpenClaw transcripts/media; cc-connect persists cc-connect session stores/media under ClawX-managed userData. |
| Progress and observability | Shared events/logs | Emit structured runtime events for run lifecycle, assistant deltas, tool progress, command output, patch completion, abort, and errors. |
| Recovery | Runtime manager/provider | Stop/restart/rollback cleanly; preserve durable session state; do not leave orphan runtime or Codex child processes. |

### State Ownership

The runtime abstraction deliberately separates durable session state, transient
turn state, provider configuration, and renderer state. The same physical store
can contain several records, but ownership should stay explicit.

| State | Owner | Persistence rule | Notes |
| --- | --- | --- | --- |
| Active runtime selection | Settings store + `RuntimeManager` | Persist user selection, but default to OpenClaw until release gate changes | Developer-mode gating is product policy, not runtime architecture. |
| Runtime process state | Runtime provider | Transient; reconstruct from process and managed config on startup | Includes pid, selected ports, health, crash restart counters, and bridge connection state. |
| Chat turn state | Runtime provider + shared chat events | Transient per run | `run.started`, deltas, tool events, abort, and final message use shared event shapes. |
| Session/history | Runtime-owned session stores | Durable runtime state | OpenClaw reads OpenClaw transcripts; cc-connect reads cc-connect-owned session stores. ClawX must not read user-global Codex transcript JSONL as a shortcut. |
| Provider/model profile | ClawX provider service + runtime provider | Durable ClawX provider config plus runtime materialization | cc-connect mode writes a managed Codex launch profile. Unsupported vendors return stable unsupported results. |
| Codex OAuth | ClawX-managed `CODEX_HOME` and secure storage | Durable but runtime-scoped | Renderer can inspect status and trigger import/logout, but token values are never exposed. |
| Skills | ClawX skills source + runtime mirror | Source remains local skills; cc-connect mirror is generated | Skills UI opens the active runtime target instead of hardcoding OpenClaw paths. |
| Cron jobs | Shared Cron Host API; runtime provider implementation | Durable in active runtime config/API | Prompt-job run is validated for cc-connect. Exec-job run remains version-gated. |
| Channels | Shared Channels Host API; runtime provider implementation | Durable runtime/channel config | cc-connect projects account config, reloads Management API state, and reads live project platform status; local real-binary reload/status smoke is covered, but Feishu/Lark inbound delivery and a passing sandbox run are still required before replacement-ready parity. |
| Files/media | Runtime-aware media service | Durable under runtime media roots | OpenClaw media stays in OpenClaw roots; cc-connect media stays under ClawX-managed userData with fallback for historical OpenClaw records. |
| Diagnostics/logs | Runtime provider + diagnostics service | Durable logs, generated snapshots | Snapshots must redact tokens and include enough evidence for startup, auth, bundle, Management API, and bridge state. |

### Data Flow By Shared Surface

| Surface | OpenClaw path | cc-connect path | Design constraint |
| --- | --- | --- | --- |
| Chat | Renderer -> Host API -> `OpenClawRuntimeProvider` -> Gateway | Renderer -> Host API -> `CcConnectRuntimeProvider` -> BridgePlatform -> cc-connect -> Codex | ClawX never calls Codex directly for chat in cc-connect mode. |
| Sessions/history | Gateway session APIs/transcripts | cc-connect session store and bridge/session metadata | App-visible session keys stay `agent:*`; bridge storage can use internal `clawx:*`. |
| Cron | OpenClaw cron APIs | cc-connect Management API with BridgePlatform fallback for prompt run; explicit external delivery is preserved as structured delivery metadata; opt-in local smoke proves real scheduled exec delivery through the cc-connect scheduler; ClawX adds a runtime-owned scheduled prompt fallback that still sends through cc-connect BridgePlatform | Unsupported exec run must be explicit and non-mutating; live tenant-channel scheduled delivery remains unproven. |
| Skills | OpenClaw skills directories | Enabled local skills mirrored into managed Codex home | Mirror is generated runtime state, not the source of truth. |
| Providers/models | OpenClaw provider config | Managed Codex profile and OAuth/API-key materialization | Runtime provider owns conversion and unsupported-provider errors. |
| Channels | OpenClaw channel config/lifecycle | cc-connect project platform config/reload/status, including same-project multi-account Feishu/Lark status mapping | Feishu/Lark has an opt-in real credential lifecycle spec; live inbound delivery and passing sandbox evidence are required before parity. |
| Doctor/logs | OpenClaw Doctor and Gateway logs | cc-connect `doctor user-isolation`, runtime logs, bundle metadata, Management API health | Doctor labels must distinguish isolation checks from OpenClaw repair. |

### Current Architecture Satisfaction

| Architecture requirement | Current state |
| --- | --- |
| Renderer boundary | Satisfied for the runtime abstraction path. Renderer uses `host-api`/`api-client` and main-owned proxy routes. |
| Runtime routing | Satisfied. `RuntimeManager` selects OpenClaw or cc-connect behind one provider contract. |
| Shared session/history surface | Mostly satisfied. Both providers expose list/history/summary/delete/rename through the runtime RPC layer. cc-connect preserves explicit session names, prevents base-key `user_meta` from masking named/orphan session titles, merges matching history across session stores, renames active/direct/supplemental labels without touching OpenClaw session files, deletes active and named session ids for a key, supplies transcript-derived titles/previews, and gated real OAuth validates main-agent restart reload plus delete. Broader live-channel history shapes and token/cost fidelity still need more runtime evidence. |
| Shared chat surface | Satisfied for current cc-connect/Codex scope. BridgePlatform maps text, streamed deltas, media, tool/command/patch events, and generated-file `toolCall` blocks into shared renderer shapes. Abort works through local run termination plus cc-connect restart; upstream single-run cancellation remains a cleaner future primitive. |
| Shared cron surface | Satisfied for prompt cron. Management API add/list/edit/delete/toggle is implemented; prompt-job run is validated through real OAuth with BridgePlatform fallback, including a non-main `research` agent session. Real bundle smoke covers exec cron field mapping, basic `delivery.mode`/`silent`, cc-connect `mute` persistence, and `continue`/`reuse` session-mode translation. Opt-in scheduled cron smoke proves a real enabled exec cron scheduler tick writes through the configured `work_dir` without model credentials. ClawX runtime now fallback-schedules due prompt cron jobs through cc-connect BridgePlatform while deduping by cron slot. Heartbeat, external tenant-channel delivery targets, and actual muted scheduled-delivery behavior remain gaps. |
| Shared skills surface | Satisfied for local skills. Enabled skills mirror into managed Codex home, and Skills UI opens a runtime-aware source or cc-connect mirror target. Slash/custom-command behavior and setup prompts remain future parity work. |
| Shared provider/model surface | Satisfied for Codex-compatible profiles. OpenAI API key, OpenAI OAuth/Codex, OpenAI-compatible Responses, ModelHub Responses, and Ollama/custom Responses paths are covered; unsupported vendors, Chat Completions custom providers, runtime model switching, and direct cc-connect provider API adoption remain partial. |
| Shared channels surface | Partially satisfied. Config projection, Feishu/Lark field mapping, status probes, channel session history, lifecycle reload RPCs, local real-binary reload/status smoke, and an opt-in real Feishu/Lark credential smoke exist; a passing sandbox run plus inbound message delivery evidence are still required before replacement-ready parity. |
| Shared doctor/logs surface | Partially satisfied. cc-connect isolation doctor, process/config logs, runtime diagnostics, bundle metadata, and Management API health exist; Codex doctor output and richer structured runtime error classification remain gaps. OpenClaw Doctor Fix remains OpenClaw-specific. |
| cc-connect startup and Codex backend | Satisfied in current smoke scope. Bundled cc-connect starts, managed config is written, BridgePlatform reaches bundled Codex, managed `CODEX_HOME` OAuth works, and real OAuth smoke covers chat/session/project/skill/prompt-cron. |
| Additional backends: PiAgent/Claude Code | Extension path only. cc-connect may support them underneath, but ClawX has not integrated provider setup, process lifecycle, session/history mapping, or capability states for those backends. |

### Runtime Contract

- `RuntimeKind = 'openclaw' | 'cc-connect'`
- `RuntimeStatus` extends the existing gateway status semantics and adds:
  - `runtimeKind`
  - `capabilities`
  - `operationCapabilities`
  - `configDir`
- `RuntimeProvider` exposes:
  - `start`
  - `stop`
  - `restart`
  - `getStatus`
  - `checkHealth`
  - `rpc`
  - `sendMessageWithMedia`
  - `listSessions`
  - `loadHistory`
  - `deleteSession`
  - `listLogs`
  - `listCapabilities`
  - `listOperationCapabilities`

### Provider Ownership

- `OpenClawRuntimeProvider` wraps the existing `GatewayManager`. OpenClaw behavior stays the default and the rollback path.
- `CcConnectRuntimeProvider` owns:
  - binary path resolution
  - managed config creation
  - process lifecycle
  - stdout/stderr capture
  - `doctor user-isolation` execution against the managed config
  - provider/model profile sync for supported Codex launch modes
  - managed `CODEX_HOME` creation for OpenAI OAuth so cc-connect mode does not depend on user `~/.codex`
  - Codex OAuth mode where ClawX can inspect managed auth, explicitly import a
    user-selected Codex `auth.json`, and clear managed auth/OAuth secret on logout
  - real Electron Host API status/import/logout lifecycle for Codex OAuth using
    isolated auth state, including token redaction in responses and public
    provider profiles
  - stable unsupported responses for missing capabilities
- `HostApiContext` and typed host services use `RuntimeManager`. Legacy `gateway:*` IPC and events remain available for compatibility.

OpenClaw-specific logic remains scoped to the OpenClaw path:

- `openclaw-auth`
- `openclaw-proxy`
- OpenClaw Doctor
- OpenClaw Skills
- OpenClaw Control UI
- OpenClaw config repair

When `cc-connect` is active, the same typed `gateway.controlUi` host route opens cc-connect Web Admin instead of OpenClaw Control UI.

Provider, agent, channel, and cron routes should be migrated capability-by-capability. They must not assume `~/.openclaw` when the active runtime is not OpenClaw.

### Failure And Recovery Design

| Failure mode | Expected behavior | Validation status |
| --- | --- | --- |
| cc-connect binary missing | Startup fails with a clear bundle/setup error and does not mutate OpenClaw runtime state | Covered by bundle/runtime unit tests. |
| Codex binary missing | cc-connect provider reports managed Codex path error; renderer sees stable runtime failure | Covered by provider profile/runtime tests. |
| Default ports occupied | Provider selects fallback localhost ports and writes them into managed config; status, diagnostics, Control UI, and Management API calls use selected ports | Covered by real bundled E2E. |
| cc-connect crash | Bridge closes, polling stops, status becomes error/degraded, and bounded restart is scheduled | Covered by runtime provider unit tests. |
| Runtime stop/restart/rollback | Provider terminates cc-connect process tree and Codex children; OpenClaw path remains available | Covered by unit and real bundled E2E. |
| App quit | `before-quit` routes through runtime manager stop and releases runtime ports/processes | Covered by real bundled E2E and packaged macOS dir smoke. |
| Missing/expired Codex OAuth | Settings and Host API expose managed auth status/import/logout/relogin paths; expired-token recovery still needs live validation | Host API status/import/logout lifecycle is covered by isolated Electron E2E; live browser relogin and expired-token recovery remain gaps. |
| Unsupported operation | Host API returns stable unsupported/degraded response and should not mutate OpenClaw config | Covered for key provider/channel/cron paths; expand with real-runtime edge cases. |
| Chat abort | Active run emits shared `aborted` event, suppresses late replies, and restarts cc-connect to terminate in-flight Codex work | Covered by unit tests and a local OpenAI-compatible real-runtime Stop smoke. Upstream single-run cancellation remains a gap. |
| Session history missing | ClawX does not read user-global Codex transcript JSONL directly; missing chat history is a cc-connect/session-store issue | Covered by bridge adapter unit tests. |

### Acceptance Definition

The first cc-connect/Codex runtime milestone is accepted when all of the
following are true:

- ClawX can start cc-connect from managed/bundled paths without global installs.
- cc-connect receives a managed config with Codex command, `CODEX_HOME`,
  provider profile, project workspace, skills mirror, BridgePlatform settings,
  and Management API settings.
- Renderer calls for chat, session/history, cron, skills, providers, files/media,
  diagnostics, and Control UI continue to go through Host API surfaces.
- Real OAuth smoke proves chat, session summary/history, restart reload, delete,
  project `work_dir`, skills mirror, and prompt cron create/list/run/toggle/delete.
- Unit and E2E coverage prove media/tool/command/patch packet mapping,
  operation-capability guards, fallback ports, crash restart, app quit cleanup,
  rollback cleanup, and packaged macOS dir startup.
- The documentation keeps non-parity areas visible instead of promoting
  cc-connect as a full OpenClaw replacement.

The milestone is not equivalent to full OpenClaw replacement. Replacement
requires explicit validation or release exceptions for live channel lifecycle,
exec cron modes, rich media/card/button/preview/update/delete packet delivery beyond generated-file cards,
upstream single-run cancellation, expired OAuth recovery, richer Codex
diagnostics, notarized release artifacts, and Windows/Linux packaged cleanup.

## cc-connect Managed Runtime

ClawX owns cc-connect state under:

```text
app.getPath('userData')/runtimes/cc-connect/
```

The first managed files are:

- `config.toml`
- `provider-profile.json`
- `data/sessions/`
- `codex-home/`
- `workspaces/<agent-id>/`
- runtime logs
- runtime working directory

ClawX must not read or mutate `~/.cc-connect` automatically.

Workspace selection is compatibility-first:

- Explicit ClawX overrides such as `CLAWX_CODEX_WORKDIR` or a provider-supplied
  runtime `workDir` win.
- If the OpenClaw agent config points at an existing workspace directory, the
  cc-connect runtime reuses that workspace for the matching agent so existing
  user files and project context continue to work after switching runtimes.
- If no configured OpenClaw workspace exists, ClawX creates and uses
  `app.getPath('userData')/runtimes/cc-connect/workspaces/<agent-id>/`.
- ClawX does not default to the ClawX source checkout or to `process.cwd()` as a
  runtime workspace.

## Packaging Design

`cc-connect` and `@openai/codex` are `devDependency` entries because the packaged runtime executes verified bundle artifacts from `extraResources`, not from asar `node_modules` or global installs.

`scripts/bundle-cc-connect.mjs`:

- Reads `cc-connect/package.json` version.
- Resolves release assets named `cc-connect-v${version}-${platform}-${arch}`.
- Supports:
  - `darwin-x64`
  - `darwin-arm64`
  - `linux-x64`
  - `linux-arm64`
  - `win32-x64`
- Downloads from release sources during build; each URL is bounded by
  `CLAWX_CC_CONNECT_DOWNLOAD_TIMEOUT_MS` (default `30000`) so a stalled mirror
  can fall through to the next source.
- Extracts to `build/cc-connect/<platform>-<arch>/cc-connect[.exe]`.
- Runs `--version` and requires the expected version.
- Writes `manifest.json` containing version, platform, arch, source URL, and SHA-256 integrity.
- Applies executable permissions on POSIX binaries.

`electron-builder.yml` copies the prepared platform directory to:

```text
process.resourcesPath/cc-connect/
process.resourcesPath/codex/
```

The binary is intentionally outside asar so it remains executable.

## Runtime Path Resolution

- Development: use `build/cc-connect/<platform>-<arch>/cc-connect[.exe]` and `build/codex/<platform>-<arch>/bin/codex[.exe]`.
- Packaged: use `process.resourcesPath/cc-connect/cc-connect[.exe]` and `process.resourcesPath/codex/bin/codex[.exe]`.
- If a binary is missing, the provider reports a clear startup error instructing developers to run the matching bundle script.

## Migration Plan

The migration follows the architecture layers instead of treating cc-connect as
a one-off alternative binary.

1. **Runtime kernel**
   - Introduce shared runtime types, `RuntimeProvider`, `RuntimeManager`, status
     envelopes, and operation-level capability metadata.
   - Wrap existing `GatewayManager` with `OpenClawRuntimeProvider` first so the
     default path proves the abstraction does not regress OpenClaw.
2. **cc-connect provider**
   - Add `CcConnectRuntimeProvider` with managed config, binary resolution,
     process lifecycle, crash restart, stop/rollback cleanup, logs, and doctor
     support.
   - Keep all cc-connect state under ClawX-managed userData.
3. **Host API migration**
   - Move status/start/stop/restart/health/rpc/chat/session/history/log routes
     through `RuntimeManager`.
   - Preserve legacy `gateway:*` IPC and event envelopes as compatibility
     shims, but make the active runtime the owner of behavior.
4. **Shared capability surfaces**
   - Migrate providers/models, channels, cron, skills, files/media, diagnostics,
     and Control UI capability-by-capability.
   - Each migrated surface must use operation support metadata instead of
     assuming OpenClaw parity.
5. **Codex backend integration**
   - Bundle Codex, create managed `CODEX_HOME`, sync provider profiles, mirror
     enabled skills, and route agent/project workspace selection into
     cc-connect project config.
   - ClawX prepares Codex paths and credentials for cc-connect, but runtime chat
     and history still flow through cc-connect.
6. **Packaging and validation**
   - Bundle cc-connect and Codex outside asar, verify manifests, run real bundle
     smoke tests, add macOS packaged-dir smoke, and keep Windows/Linux release
     smoke as release-readiness work.
7. **Documentation and rollout**
   - Keep the architecture image, capability matrix, README notes, harness
     specs, and gap register aligned.
   - Treat OpenClaw as the default runtime until replacement-readiness gaps have
     explicit validation or a release exception.

cc-connect runtime mode sends GUI chat through the ClawX BridgePlatform adapter
into cc-connect. cc-connect then invokes the configured Codex project agent.
Sessions, history, cron, skills, channels, files/media, diagnostics, and
supported provider/model selection stay behind the same Host API layer so the
core product surface can run without depending on OpenClaw Gateway.

In cc-connect runtime mode, ClawX must not communicate with Codex directly. That
includes direct Codex CLI process execution and direct reads of user-global
Codex transcript or runtime state files. ClawX may prepare the bundled Codex
executable path, managed `CODEX_HOME`, and provider profile for cc-connect.
Token usage may consume `token_count` events from that managed `CODEX_HOME` only
when the events are linked from cc-connect-owned session stores or attributable
to a configured/managed cc-connect project workspace through transcript
`session_meta.cwd`. All runtime
execution, chat, sessions, history, and tool/artifact events must flow through
cc-connect BridgePlatform, Management API, or cc-connect-owned session stores.

## Rollback Strategy

- Switch Settings runtime back to OpenClaw.
- Stop the cc-connect process.
- Keep the managed cc-connect config directory intact for future reuse.
- OpenClaw remains the default runtime and the release rollback path.

## Test Plan

- Unit:
  - `RuntimeManager` default selection, switching, fallback, and event forwarding.
  - `OpenClawRuntimeProvider` preserves Gateway behavior.
  - `CcConnectRuntimeProvider` mock binary startup, stop, crash, config path,
    provider profile, and logs.
  - cc-connect provider profile conversion for OpenAI/Codex,
    OpenAI-compatible Responses Custom providers, Ollama, and unsupported
    providers.
  - cc-connect bridge adapter packet mapping for replies, streamed deltas,
    media, tool/command/patch events, generated-file `toolCall` messages,
    abort, and late reply suppression.
  - Runtime operation capability guards for degraded/unsupported sub-operations.
  - Runtime-aware file/media roots and skills target resolution.
  - cc-connect bundler URL mapping, manifest generation, version mismatch, and failure cases.
- Integration:
  - Host API returns stable envelopes in both runtimes.
  - Unsupported provider/cron operations do not mutate OpenClaw config, and
    channel status probes use the active runtime.
  - Provider API sync uses cc-connect runtime profile when cc-connect is active.
- E2E:
  - Settings runtime selector.
  - OpenClaw default smoke.
  - cc-connect mock runtime chat smoke, including provider/model args for Codex.
  - OpenClaw-only controls unavailable in cc-connect mode.
  - Real bundled cc-connect startup, runtime diagnostics, fallback ports, app
    quit cleanup, and rollback-to-OpenClaw cleanup.
  - Gated real OAuth comprehensive smoke for chat, sessions/history, project
    workspace, real file-writing tool evidence, skills mirroring, main-agent
    prompt cron create/list/run/toggle/delete, and cross-agent research cron
    create/list/run/delete.
  - Local real-validation matrix:
    `pnpm run verify:cc-connect:local-real` writes a sanitized preflight report
    to `artifacts/cc-connect/local-real-validation-report.{json,md}` covering
    current runtime bundles, local Codex OAuth availability, OpenAI API-key and
    Feishu/Lark credential preconditions, packaged macOS app availability, and
    residual cc-connect/Codex runtime processes. The verifier automatically
    loads untracked and gitignored `.env.cc-connect.local`, `.env.local`, and
    `.env` files when present, and supports additional `--env-file=<path>`
    inputs. Any loaded env file inside the repository must be untracked and
    gitignored; explicit env files outside the repository are allowed but are
    reported only as outside-repo summaries without absolute paths. The tracked
    `.env.cc-connect.local.example` file documents the required local fields
    without containing secret values. Reports record only file names, variable
    names, gitignore safety, and value lengths, never secret values. The Codex
    OAuth auth summary records only token key names, missing required token-key
    names, and sanitized expiry metadata (`expiryStatus` and `expiresAt`);
    token values are never written to JSON or Markdown reports. If the
    explicitly supplied auth file is incomplete or clearly expired, the verifier
    treats real OAuth validation as a missing precondition instead of copying
    stale credentials into the managed `CODEX_HOME`. Requested
    real-credential commands that cannot run because a local
    precondition is missing are written as `skipped` command records, so the
    JSON and Markdown `Command Results` table distinguish "passed" from "not
    actually exercised." The report also writes a `Runtime Parity Coverage`
    matrix that maps each runtime claim to its evidence command: current
    bundles, compile/skip semantics, Codex OAuth lifecycle local diagnostics,
    Codex OAuth Host API lifecycle, provider/model profile local diagnostics,
    token usage contract local diagnostics, runtime management bundle local
    diagnostics, BridgePlatform image/file/audio packet diagnostics,
    BridgePlatform rich packet diagnostics, channel lifecycle local bundle
    semantics, cron lifecycle local bundle semantics, scheduled exec cron
    delivery, scheduled prompt cron bridge limitation probing, OAuth core
    parity, local OpenAI-compatible API-key chat, local OpenAI-compatible chat
    abort, real OpenAI API-key provider/model chat, Feishu/Lark channel
    lifecycle, and packaged OAuth smoke. The
    `codex-oauth-lifecycle-local-diagnostics` row runs deterministic
    verifier coverage for explicit import requirement, complete token field
    requirement, expired-auth rejection, sanitized expiry metadata, and
    missing-token-key reporting without token values. The
    `codex-oauth-host-api-lifecycle-local` row runs real Electron Host API
    `providers.codexOAuthStatus`, `providers.importCodexOAuth`, and
    `providers.logoutCodexOAuth` against isolated synthetic Codex auth state,
    verifies managed auth-file creation/deletion and provider OAuth secret
    cleanup, and asserts responses plus public provider profiles do not leak
    token values. Provider/model
    local diagnostics run deterministic unit coverage for API-key/OAuth/custom
    Responses materialization, unsupported-provider diagnostics, secret
    redaction, and running-runtime provider/model sync restart. Token usage
    local diagnostics run deterministic unit plus Electron IPC coverage for
    cc-connect-owned session-store usage, managed `CODEX_HOME` `token_count`
    usage attributed by session-store linkage or managed-workspace
    `session_meta.cwd`, `runtimeKind` tagging, cross-agent and cron session ids,
    and exclusion of user-global or unattributed Codex transcripts. Runtime management
    bundle diagnostics run the real bundled cc-connect E2E smoke for startup,
    runtime diagnostics redaction, fallback ports, Management API channel
    reload/status, Management API cron lifecycle, cc-connect doctor
    user-isolation, quit cleanup, and rollback cleanup.
    `bridge-media-packets-local-diagnostics` runs
    deterministic BridgePlatform adapter coverage for image/file/audio packets,
    cc-connect managed media writes, image data-URL previews, and file/audio
    preview suppression. `bridge-rich-packets-local-diagnostics` covers
    adapter handling for card/buttons, preview acknowledgements, update-message
    deltas, delete-message no-op stability, and typing no-op stability. These
    rows prove shared message mapping only; they do not replace real upstream
    rich card/button/preview/update/delete delivery evidence. The real bundled
    smoke is also
    exposed as a dedicated `channel-lifecycle-local-bundle` coverage row for
    Host API `channels.connect`/`channels.disconnect`, managed config reload
    without cc-connect restart, real user channel credential removal, local
    placeholder platform preservation, and credential-free Feishu/Lark
    config projection for domain aliases, agent binding, account-scoped
    status, and workspace isolation. It is also exposed as a dedicated
    `cron-lifecycle-local-bundle` coverage row for Management API cron
    create/list/update/toggle/delete, non-main agent project routing,
    prompt/exec field mapping, `work_dir`, `session_mode`, `timeout_mins`,
    `mute`/`silent`, and manual exec-run unsupported semantics. These rows
    improve local contract evidence but do not replace the real OpenAI API-key
    chat, real OAuth live usage, live scheduled cron delivery, or live
    Feishu/Lark tenant-delivery or inbound-delivery coverage rows. The
    `local-openai-compatible-api-key-chat` row proves the OpenAI API-key
    provider/baseUrl/model/secret-redaction path through real cc-connect and
    bundled Codex against a local Responses-compatible server, including
    `runtimeKind: cc-connect` token usage collection for that same chat; it
    deliberately does not satisfy replacement readiness for external OpenAI
    API-key evidence.
    The report also writes a top-level `runtimeMatrixStatus` plus a
    `Replacement Readiness` summary derived from the required replacement rows.
    `runtimeMatrixStatus` stays `partial` when the only missing evidence is a
    skipped or not-run real OpenAI API-key or Feishu/Lark row. The checks table
    always includes a `replacement-readiness` row: it is `PARTIAL` for
    informational reports when replacement evidence is incomplete, and becomes
    `FAIL` only when `--require-replacement-ready` is supplied as a hard gate.
    This separates "available runtime checks failed" from "replacement evidence
    is incomplete." Missing rows record the next command needed to prove that
    area. The report also includes a machine-readable `replacementContract`
    checklist plus a Markdown `Replacement Contract Checklist` section for the
    current cc-connect replacement decisions: Developer Mode gating remains
    unchanged; Doctor Fix non-parity is explicit; BridgePlatform-only runtime
    ownership forbids direct ClawX-to-Codex chat/session/history/tool execution;
    Codex OAuth and OpenAI API-key evidence are tracked separately; provider/model limitations are not
    implied parity; Feishu/Lark local config projection does not replace live
    tenant delivery; cron lifecycle and scheduled exec delivery do not replace
    real scheduled prompt/channel delivery; session/history and token usage
    parity are tied to runtime-owned evidence; real validation remains opt-in;
    and all-platform packaging smoke remains a release-validation item. The
    checklist preserves `partial` statuses for external-credential and
    release-platform gaps instead of letting local smokes make cc-connect look
    fully replacement-ready. Credential-gated coverage rows use
    missing-precondition state to distinguish validation that cannot run from
    validation that was simply not requested: when credentials or a packaged app
    are absent, the row is `skipped` with a sanitized reason even if the opt-in
    child command was not requested; when prerequisites are present but the
    command was not requested, the row remains `not-run`. The same report includes
    `validationGaps` JSON plus a Markdown `Validation Gaps` table. Required
    gaps block the local replacement-readiness gate; follow-up gaps record
    unverified replacement evidence that still matters for full OpenClaw parity
    but remains outside the opt-in local hard gate, including live Feishu/Lark
    inbound delivery, real scheduled prompt/channel cron delivery, rich media/card/button/preview/update/delete
    packet delivery beyond generated-file cards, notarized macOS dmg/zip smoke, and Windows/Linux
    packaged smoke.
    The same report includes
    sanitized missing-precondition records with the
    required variable names and next validation command, but no credential
    values. It also writes sanitized `nextActions` JSON plus a Markdown `Next Actions`
    section that merges missing credential preconditions, non-PASS replacement
    coverage, and upstream cc-connect primitive gaps into concrete follow-up
    commands or actions. The
    companion
    `pnpm run verify:cc-connect:local-real:run` command also executes safe
    local validation commands while leaving real credential checks opt-in.
    The direct real E2E specs for OpenAI API-key and Feishu/Lark validation
    load the same default local env files only when repository-local files are
    untracked and gitignored, without overriding values already present in the
    process environment, so developers can run the focused Playwright commands
    directly or through the verifier with the same local credential setup.
    The verifier and direct Playwright runs may also set
    `CLAWX_REAL_ENV_FILE` to one extra env file or `CLAWX_REAL_ENV_FILES` to a
    `path.delimiter`-separated list. Files outside the repository are allowed;
    summary metadata uses only file basenames, never absolute paths.
    `pnpm run verify:cc-connect:local-real:oauth` adds the gated dev real OAuth
    comprehensive smoke, and `pnpm run verify:cc-connect:local-real:oauth-all`
    runs both dev and packaged real OAuth smokes when local Codex auth is
    available.
    `pnpm run verify:cc-connect:local-real:api-key` always runs the local
    OpenAI-compatible API-key smoke through real cc-connect and bundled Codex,
    and additionally runs the real OpenAI API-key smoke when
    `CLAWX_REAL_OPENAI_API_KEY` or `OPENAI_API_KEY` is available from process
    env or a local env file. The verifier maps
    `CLAWX_REAL_OPENAI_API_KEY` to child-process `OPENAI_API_KEY` without
    writing the value to reports. `CLAWX_REAL_OPENAI_MODEL` may be supplied
    when the default API-key smoke model is unavailable for the test account.
    `pnpm run verify:cc-connect:local-real:feishu` runs the real
    Feishu/Lark lifecycle smoke when app credentials and Codex auth are
    available. `pnpm run verify:cc-connect:local-real:feishu-inbound` runs the
    manual tenant-message inbound marker smoke when
    `CLAWX_REAL_FEISHU_INBOUND_E2E=1` is set and a sandbox chat can send the
    verifier marker to the configured bot during the timeout. The inbound
    smoke writes `artifacts/cc-connect/feishu-inbound-marker.json` with the
    exact non-secret marker to send so the manual handoff is not lost in
    transient Playwright logs. `pnpm run verify:cc-connect:local-real:scheduled-cron` runs an
    opt-in local smoke that waits for a real cc-connect exec cron scheduler
    tick without model, API-key, or channel credentials; when explicit Codex
    OAuth auth is available it also runs
    `pnpm run test:e2e:cc-connect:real-scheduled-prompt-cron`, which verifies
    ClawX's runtime-owned scheduled prompt fallback through cc-connect
    BridgePlatform. `pnpm run verify:cc-connect:local-real:all` runs every available
    local real path, records unavailable credential paths as `SKIPPED`, and
    writes the Markdown and JSON external gate handoff artifacts from the same sanitized report unless
    `--strict-real` is supplied. The verifier also supports
    `--require-coverage=<all|id,id>` to turn selected `Runtime Parity Coverage`
    rows into a hard gate; its `required-coverage` check means only that the
    explicitly requested rows are `PASS`. `--require-replacement-ready` is the
    stricter high-level gate: it fails the overall report unless every
    replacement-readiness row is `PASS`, while the separate
    `runtimeMatrixStatus` still reports whether the runtime parity matrix is
    `pass`, `partial`, or `fail`.
    The report also probes the bundled cc-connect CLI surface and records
    command-level facts such as `send`, `cron`, `sessions`, provider, Feishu
    setup/bind, config examples, and doctor user-isolation evidence. Missing
    upstream primitives, including undocumented per-platform channel
    connect/disconnect, are written into the report instead of being inferred
    away from a broad channel capability flag.
    For release-candidate validation,
    `pnpm run verify:cc-connect:local-real:all-strict` runs the same matrix,
    writes the external gate handoff artifacts, and exits non-zero when real OpenAI
    API-key or Feishu/Lark preconditions are missing, or when replacement
    readiness is not achieved.
    `pnpm run verify:cc-connect:local-real:replacement-ready` runs the same
    matrix with the replacement-readiness gate and handoff output, but without
    treating missing credentials as a separate strict preflight failure.
    `pnpm run verify:cc-connect:local-real:replacement-ready:check` adds
    `--no-write` to the same gate so a quick readiness check cannot overwrite
    the last full local-real report artifacts.
    `pnpm run verify:cc-connect:local-real:external-gates:check` is the
    non-destructive post-credential readiness check for the remaining external
    gates. It skips the safe local baseline commands, runs only the real
    OpenAI API-key, Feishu/Lark lifecycle, and Feishu/Lark inbound
    tenant-message gates, and exits non-zero unless all three external
    coverage rows are `PASS`, without overwriting the last full report. Even
    in `--no-write` mode, the verifier prints a sanitized console summary with
    missing precondition ids, required variable names, and next commands.
    `pnpm run verify:cc-connect:local-real:external-gates` runs the same short
    path and writes fresh external gate handoff artifacts.
    `pnpm run verify:cc-connect:local-real:handoff` reads the latest sanitized
    report and writes `artifacts/cc-connect/local-real-external-gates.{md,json}`
    without rerunning validation. The direct verifier flag `--write-handoff`
    writes the same credential-free human-readable and machine-readable checklists
    from the in-memory report in the same run. The checklists cover the remaining real OpenAI API-key,
    Feishu/Lark lifecycle, and Feishu/Lark inbound tenant-message gates, and
    lists only required variable names, commands, statuses, and the sanitized
    inbound marker artifact path.
    `pnpm run verify:cc-connect:local-real:packaged-oauth` additionally runs
    the packaged macOS cc-connect real OAuth smoke when a packaged app and
    local Codex auth source are available.
  - Gated real OpenAI API key smoke:
    `CLAWX_REAL_OPENAI_API_KEY_E2E=1 CLAWX_REAL_OPENAI_API_KEY=... pnpm run test:e2e:cc-connect:real-openai-api-key`
    with optional `CLAWX_REAL_OPENAI_MODEL`. This verifies real bundled
    cc-connect + Codex chat through API-key auth and asserts the raw key is not
    persisted into managed `config.toml` or public provider profile. The test
    also asserts that app shutdown leaves no process referencing the managed
    cc-connect runtime directory.
  - Gated real Feishu/Lark channel smoke:
    `CLAWX_REAL_FEISHU_E2E=1 pnpm run test:e2e:cc-connect:real-feishu`
    with `CLAWX_REAL_FEISHU_APP_ID`, `CLAWX_REAL_FEISHU_APP_SECRET`,
    optional `CLAWX_REAL_FEISHU_DOMAIN` (`feishu`, `lark`, `cn`, `global`, or
    full API base URL), optional `CLAWX_REAL_FEISHU_ACCOUNT_ID`, and optional
    `CLAWX_REAL_FEISHU_ALLOW_FROM`. This verifies isolated config projection,
    bound-agent project routing, runtime status, connect/disconnect reload
    refresh, delete cleanup through the runtime layer, and no managed runtime
    process leaks after app shutdown. It does not by itself prove inbound
    message delivery; run
    `CLAWX_REAL_FEISHU_INBOUND_E2E=1 pnpm run test:e2e:cc-connect:real-feishu-inbound`
    with the same credentials and send the printed marker from the sandbox
    tenant chat to prove cc-connect records a real inbound tenant message in
    the managed session store.
- Packaging:
  - `pnpm run package:mac:dir` then `pnpm run smoke:cc-connect:packaged -- --app=release/mac-arm64/ClawX.app`.
  - Optional packaged real OAuth chat: `pnpm run smoke:cc-connect:packaged -- --app=release/mac-arm64/ClawX.app --real-oauth=1`.
  - Windows/Linux CI checks packaged `cc-connect/cc-connect[.exe]` and `codex/bin/codex[.exe]` resource startup and cleanup.
  - Because this touches communication paths, run `pnpm run comms:replay` and `pnpm run comms:compare`.

## Assumptions

- OpenClaw remains the default runtime.
- First-version cc-connect acceptance is core-equivalent for chat, sessions, history, providers/models, cron, and skills, not full OpenClaw-specific parity.
- ClawX manages cc-connect config and does not modify `~/.cc-connect`.
- Packaged ClawX must run cc-connect and Codex offline without global install or runtime download.

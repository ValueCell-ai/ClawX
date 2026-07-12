# ClawX Runtime Abstraction and cc-connect Replacement Specification

Status: implementation contract
Updated: 2026-07-12
Default runtime: `openclaw`
Optional runtime: `cc-connect` behind Developer Mode

## 1. Objective

ClawX must expose one runtime layer whose OpenClaw and cc-connect providers
support the same product surfaces. OpenClaw remains the default and rollback
path. cc-connect is accepted as a replacement only when chat, sessions,
history, tools, provider credentials, Feishu/Lark, native cron, usage,
skills, diagnostics, and packaged startup are proven through the cc-connect
process rather than through ClawX-to-Codex shortcuts.

The non-negotiable execution boundary is:

```text
Renderer -> Host API -> RuntimeManager -> CcConnectRuntimeProvider
         -> cc-connect Bridge/Management API -> cc-connect -> Codex
```

ClawX may supply the Codex binary path, provider environment, `CODEX_HOME`,
workspace, skills, and credentials to cc-connect. It must not spawn Codex for
chat, parse Codex files as the production real-time event transport, or invoke
Codex session commands directly.

## 2. Version and packaging decision

The original prototype pinned `cc-connect@1.3.2`. That package contains only a
CLI wrapper, install script, and documentation; its postinstall downloads a
release binary into `node_modules/cc-connect/bin`. Declaring the dependency is
therefore insufficient for Electron packaging.

The replacement implementation targets stable `cc-connect@1.4.1` because its
published runtime surface includes Bridge REST session management and a broader
Management API. The exact binary, not upstream `main`, is the release contract.
Every upgrade must run the contract probe before application code adopts a new
endpoint.

Packaging requirements:

- Pin `cc-connect` exactly in `devDependencies`.
- `scripts/bundle-cc-connect.mjs` downloads release assets for macOS x64/arm64,
  Linux x64/arm64, and Windows x64.
- Verify `--version`, executable permission, SHA-256, platform, architecture,
  source URL, and package version in `manifest.json`.
- Copy the verified binary to `process.resourcesPath/cc-connect/`; never run
  postinstall or download a binary at application runtime.
- Bundle the pinned Codex CLI in `process.resourcesPath/codex/`; cc-connect is
  the only process allowed to launch it for runtime work.
- `afterPack` must reject a target whose copied cc-connect or Codex resource is
  missing, stale, corrupted, non-executable, or inconsistent with its manifest.
- Final unpacked artifacts must pass
  `pnpm run verify:packaged-runtime-resources -- --resources=<resources> --platform=<platform> --arch=<arch>`.
  Windows and Linux require exact packaged-binary SHA equality. macOS also
  requires exact SHA before signing; when `codesign` rewrites Mach-O metadata,
  the final verifier requires the source bundle SHA, all Mach-O section
  payloads, architecture/version, and `codesign --verify --strict` to agree.
- macOS, Windows, and Linux packaged jobs must run a resource/startup/cleanup
  smoke before release readiness can be claimed.
- `.github/workflows/release.yml` runs the final resource verifier for macOS
  x64/arm64, Windows x64, and Linux x64/arm64 before uploading release
  artifacts. The same release gate runs the full packaged smoke natively on
  macOS arm64, Windows x64, and Linux x64, with dedicated `macos-15-intel` and
  `ubuntu-24.04-arm` jobs for macOS x64 and Linux arm64. Publishing depends on
  all five jobs. A local run cannot replace observed CI evidence. Runner labels
  follow the [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- A manual `Release` workflow dispatch is evidence-only: it disables macOS
  signing discovery and never creates a GitHub Release, uploads to OSS, or runs
  final promotion. Publishing remains tag-only. Use an alpha/beta version label
  for manual smoke so Windows also skips SignPath. Manual macOS smoke explicitly
  records that signature validation was skipped; tag builds still require strict
  signature verification before publishing.

Primary upstream contracts:

- [cc-connect usage](https://github.com/chenhg5/cc-connect/blob/v1.4.1/docs/usage.md)
- [Management API](https://github.com/chenhg5/cc-connect/blob/v1.4.1/docs/management-api.md)
- [Bridge protocol](https://github.com/chenhg5/cc-connect/blob/v1.4.1/docs/bridge-protocol.md)

## 3. Durable data and locking

All ClawX-owned persistent state uses one upgrade-stable root. Stable, beta,
dev, and multiple installations may share it, but only one writer may run at a
time.

```text
~/.clawx/
  state/
    data-version.json
    migration-journal.jsonl
  locks/
    writer.lock
  app/
    settings.json
    clawx-providers.json
    runtime-config.json
    cc-connect-agent-bindings.json
    cc-connect-session-metadata.json
  credentials/
    index.json
    secrets.enc
    oauth/<provider-account-id>/codex-home/
  skills/
    installed/
    configs.json
  workspaces/
    agents/<agent-id>/
  runtimes/
    cc-connect/{config,data,media,events,logs}
    openclaw/projection-state.json
  system/electron/
  logs/
  backups/
  cache/
```

`resolveClawXDataRoot()` and `getClawXDataLayout()` are the only path-building
entry points. Production defaults to `~/.clawx`; `CLAWX_DATA_HOME` is the
supported override. Electron `userData` becomes `~/.clawx/system/electron` and
application logs use `~/.clawx/logs`.

`writer.lock` is created atomically and contains pid, owner token, app version,
channel, executable, start time, and heartbeat time. A second installation
shows the current owner and exits. Stale lock recovery requires both a dead pid
and an expired heartbeat; `force: true` deletion is forbidden.

Migrations are version-gated, journaled, additive, backed up, and atomic. An
older application that cannot understand the current data version refuses to
write. Existing Electron data is imported into `~/.clawx`; existing
`~/.openclaw` remains external compatibility data and is never moved or
deleted.

`app/runtime-config.json` is the canonical Agent, binding, channel-account, and
OpenClaw-compatible runtime metadata document. Sensitive channel fields are
removed before this file is written and are hydrated from
`credentials/secrets.enc` only in Main-process memory. `~/.openclaw/openclaw.json`
is an import/export compatibility projection, not the cc-connect state owner.
The compatibility file is imported only when canonical state does not yet
exist. Shared saves never use its mtime to overwrite canonical state. While
cc-connect is active they do not write the projection; the OpenClaw adapter
rebuilds it, including vault-backed channel secrets, immediately before
OpenClaw start or restart.

## 4. Runtime contracts

```ts
type RuntimeKind = 'openclaw' | 'cc-connect'

interface RuntimeProvider {
  kind: RuntimeKind
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  getStatus(): RuntimeStatus
  checkHealth(options?: RuntimeHealthOptions): Promise<RuntimeHealth>
  rpc<T>(method: string, params?: unknown): Promise<T>
  sendMessageWithMedia(payload: RuntimeSendPayload): Promise<RuntimeSendResult>
  abortRun(payload: RuntimeAbortPayload): Promise<RuntimeAbortResult>
  resolveApproval(payload: RuntimeApprovalResponse): Promise<void>
  listSessions(query?: RuntimeSessionQuery): Promise<RuntimeSessionPage>
  loadHistory(query: RuntimeHistoryQuery): Promise<RuntimeHistoryPage>
  deleteSession(payload: RuntimeSessionMutation): Promise<void>
  listUsage(query?: RuntimeUsageQuery): Promise<RuntimeUsagePage>
  listLogs(query?: RuntimeLogQuery): Promise<RuntimeLogPage>
  runDoctor(mode: 'diagnose' | 'fix'): Promise<RuntimeDoctorResult>
  listCapabilities(): RuntimeCapabilities
  listOperationCapabilities(): RuntimeOperationCapabilities
}
```

`RuntimeStatus` retains Gateway-compatible process states and adds
`runtimeKind`, version, config directory, capabilities, operation capabilities,
and scoped health. `gateway:*` IPC/event names remain compatibility aliases,
but their data is always supplied by the active provider.

Operation support is `native`, `proxy`, `degraded`, or `unsupported`.
`degraded` means the command remains callable but has a documented parity or
blast-radius limitation. For cc-connect v1.4.1, `chat.abort` is native: ClawX
sends the public `/stop` command over BridgePlatform for the selected session.
The whole runtime is restarted only as a disconnected-Bridge fallback when the
stop command cannot be delivered. Settings displays degraded and unsupported
operations separately from top-level capability availability.

Before a runtime status has published operation capabilities, renderer helpers
retain compatibility with legacy Gateway status. Once the operation map is
present, any undeclared method is treated as unsupported; this makes contract
drift visible instead of allowing an unreviewed runtime call to pass through.

OpenClaw-specific auth, proxy mutation, Doctor Fix, Skills implementation,
Dreams, memory repair, and Control UI remain inside the OpenClaw adapter.
Shared services must not call `GatewayManager` or write `~/.openclaw` when
cc-connect is active.

## 5. Agent, provider, model, and credential ownership

Provider Account is the stable credential identity. Agent bindings reference an
account explicitly instead of encoding identity in `provider/model` strings.

```ts
interface AgentRuntimeBinding {
  agentId: string
  providerAccountId: string
  model: string
  workspaceId: string
}
```

`agents.updateRuntimeBinding({ id, providerAccountId, model })` is the canonical
Host API. The old model-only method is a compatibility adapter and fails when
multiple accounts make the reference ambiguous.

Each cc-connect project resolves credential identity from the Agent's provider
account binding and resolves model independently from that Agent's explicit
`provider/model` override or the canonical default. Project model overrides
replace only cc-connect/Codex model arguments; they never replace or merge the
bound account's OAuth home or API-key environment.

Credential rules:

- Browser OAuth acquisition writes only the ClawX-owned provider account and
  encrypted secret. Runtime projection is dispatched through the active
  `RuntimeProvider`: cc-connect materializes its account-scoped managed
  `CODEX_HOME`, while OpenClaw retains its existing auth/config projection. A
  cc-connect OAuth success must never write OpenClaw config or schedule an
  OpenClaw Gateway restart.
- A successful cc-connect browser re-login (`reason=oauth`) replaces that
  account's managed Codex auth with the newly acquired vault secret. Ordinary
  runtime startup keeps managed auth first so Codex refresh-token rotation is
  not rolled back by an older vault snapshot.
- API keys and reusable OAuth recovery material are encrypted with Electron
  `safeStorage` in `credentials/secrets.enc`.
- Channel account secrets share the encrypted vault under account-scoped IDs;
  `credentials/index.json` contains IDs only, never secret values.
- Every OpenAI OAuth account owns a complete account-level `CODEX_HOME` under
  `credentials/oauth/<account-id>/codex-home`; auth files are mode `0600`.
- OAuth homes are not symlinked or copied between accounts. Agents may share an
  account by binding to the same account-level home.
- A pre-account shared managed Codex home is moved once to the selected default
  OAuth account and then removed; it is never copied to a second account.
- Runtime profile construction never consumes user-global `~/.codex/auth.json`.
  That file is inspected only for redacted status and copied only after the user
  explicitly invokes `importCodexOAuth` for a matching account.
- API-key projects receive account-specific environment variables. Secrets are
  never written literally to generated TOML or exposed to Renderer.
- Provider/model/account changes detach the old runtime session and create a
  new cc-connect/Codex session on the next turn while preserving visible ClawX
  history.
- Missing or incomplete credentials block only bound Agents. Access-token
  expiry does not invalidate a complete managed OAuth home because
  cc-connect/Codex owns refresh-token rotation there; a failed refresh is
  surfaced on that Agent's runtime turn and can be recovered with browser
  re-login, without changing another Agent's credentials.
- Proxy variables are supplied to cc-connect and inherited by its children;
  localhost, `127.0.0.1`, and `::1` are always added to `NO_PROXY`.

Initial verified matrix: OpenAI API key, OpenAI Codex OAuth, OpenAI-compatible
Responses, and Ollama. Unsupported providers return a stable capability error
without mutating OpenClaw config.

## 6. Workspace, skills, and plugins

New Agents use `~/.clawx/workspaces/agents/<agent-id>`. If an existing OpenClaw
Agent has a valid configured workspace, ClawX records that path as
`external-openclaw` and reuses it without copying or moving data.

Each cc-connect project receives exactly that Agent workspace as `work_dir`.
No code path may default to `process.cwd()`, the ClawX source checkout, or app
resources. Agent deletion removes only `clawx-managed` workspaces.

When a new Agent requests workspace inheritance, ClawX may read bootstrap files
from the existing OpenClaw main workspace, but writes the new Agent under the
ClawX-managed root. It never changes or assumes ownership of the source path.

ClawX owns one Skill Registry. OpenClaw receives its normal skills projection;
cc-connect receives the same enabled skills through its project/Codex skills
surface. The acceptance test must invoke a real installed skill through chat,
not only compare copied files.

Plugin reuse means shared ClawX capability, account, binding, and UI metadata.
OpenClaw JS plugins remain OpenClaw-specific. cc-connect channels are generated
as native `projects.platforms` entries and do not load OpenClaw plugins.

## 7. Chat, events, tools, approvals, and cancellation

GUI Chat registers as a cc-connect Bridge adapter. cc-connect invokes Codex and
emits all run activity over Bridge. The normalized envelope is:

The adapter follows the pinned cc-connect Web Admin client lifecycle: after
`register_ack` it sends a JSON `ping` every 25 seconds, reconnects after 3
seconds when the socket drops, and stops both timers during an intentional
runtime stop. This is required for scheduler and long-running Agent replies
that cross cc-connect's approximately 90-second idle disconnect window.

```ts
interface RuntimeEventEnvelope {
  schemaVersion: 1
  eventId: string
  runtimeKind: RuntimeKind
  project: string
  sessionKey: string
  runtimeSessionId: string
  runId: string
  turnId: string
  seq: number
  timestamp: string
  type: RuntimeEventType
  payload: unknown
}
```

Required event types are `run.started`, `assistant.delta`,
`reasoning.summary.delta`, `tool.started`, `tool.updated`, `tool.completed`,
`command.output`, `patch.completed`, `approval.requested`,
`approval.resolved`, `usage.recorded`, and `run.ended`.

Pinned cc-connect v1.4.1 has two materially different Codex backends. Its
default `exec` backend does not map Codex 0.137 `custom_tool_call` records such
as `apply_patch` to `EventToolUse`; a real OAuth probe created the requested
file while cc-connect reported `tools=0`. ClawX therefore configures every
managed Codex project with `backend = "app_server"` and
`app_server_url = "stdio://"`. cc-connect remains the process owner and starts
the bundled Codex app-server inside the Agent workspace.

The Bridge adapter registers `progress_style = "card"` and
`supports_progress_card_payload = true`. cc-connect then sends the public
`__cc_connect_progress_card_v1__:` payload through `preview_start` and
`update_message`; ClawX maps typed `thinking`, `tool_use`, `tool_result`, and
`error` entries to the shared runtime graph. cc-connect v1.4.1 emits a
`fileChange` start but no corresponding result, so a successful or failed final
Bridge reply closes any still-open tool with
`meta.inferredFromRunCompletion = true`. Explicit tool results always win and
are never replaced by the inferred terminal event.

The opt-in real OAuth E2E proves the full path: GUI send -> RuntimeManager ->
cc-connect Bridge -> cc-connect-owned Codex app-server -> Patch -> progress
payload -> Main runtime event -> Renderer execution graph. It asserts
`transport=stdio`, cc-connect `tools=1`, the managed workspace file, both tool
lifecycle events, real approval request/resolution, and the visible graph. It
writes sanitized evidence under
`artifacts/cc-connect/real-oauth-tool-events.{png,json}` plus
`artifacts/cc-connect/real-oauth-approval-request.png`. Reading Codex JSONL,
wrapping Codex stdout, or spawning a second Codex bridge remains forbidden.

Only Codex-provided reasoning summaries are shown. Hidden chain-of-thought is
never requested or inferred. `eventId` deduplicates; `runId + seq` orders and
detects gaps. Bridge reconnect must replay missing events through
cc-connect-owned history once the upstream protocol exposes them. ClawX must
not scan Codex transcript files to reconstruct real-time tool activity.

The app-server backend surfaces approval requests as Bridge `buttons`. ClawX
stores the run-correlated `session_key`, `reply_ctx`, project, and only the
actions offered by cc-connect. `chat.approval.respond` validates the requested
action against that pending set and sends cc-connect's public `card_action`
packet; Renderer never talks to Codex and cannot inject an arbitrary action.
Deterministic Electron E2E proves request rendering, GUI click, Host API/runtime
RPC dispatch, the exact Bridge packet, and resumed assistant delivery. The
opt-in real OAuth E2E additionally runs the Main Agent in `suggest` mode and
proves the same flow through bundled cc-connect 1.4.1 and bundled Codex: a real
Patch approval is rendered, allowed, resolved by cc-connect, and followed by a
workspace write and final assistant response.

Permission mode is Agent-owned runtime metadata in
`~/.clawx/app/agent-bindings.json`, alongside but independent from the Agent's
provider-account binding. `full-auto` remains the default; `suggest` selects
cc-connect app-server's `on-request` approval policy and read-only sandbox.
Saving the mode refreshes the managed project config without writing OpenClaw
configuration. Only these two safe product modes are exposed; ClawX does not
offer cc-connect's sandbox-bypassing mode.

Pinned cc-connect v1.4.1 has no dedicated incoming Bridge cancellation packet
or per-run cancellation Management endpoint, but its public `/stop` command is
session-scoped. `chat.abort` immediately ends the correlated ClawX run, sends
`/stop` through BridgePlatform for that session, and suppresses replies correlated
to the aborted run. Codex app-server does not implement cc-connect's graceful
`CancelTurn` interface, so cc-connect closes only that session's Codex child
while preserving its stored AgentSessionID for resume; the cc-connect process
and other Agent sessions remain running. If Bridge is disconnected and `/stop`
cannot be delivered, ClawX restarts the owned runtime as an explicit fallback.
The real local OpenAI-compatible E2E proves upstream stream closure, no late
assistant rendering, and an unchanged cc-connect PID.

## 8. Sessions and history

Session inventory, history, and deletion use only cc-connect's public
Management/Bridge session endpoints. ClawX does not read or mutate cc-connect
session JSON files. User-assigned titles are ClawX UI metadata stored atomically
in `app/cc-connect-session-metadata.json`; deleting a public session deletes its
title in the same Host API operation. On first use, labels from the old
ClawX-owned `.clawx-supplemental-history.json` are imported without copying its
history payload.

The production Bridge adapter contains no parser for cc-connect session JSON or
Codex transcripts. It retains only messages observed on the current public
Bridge connection for immediate event delivery; durable list/history/delete
always come from the provider's public Management session client.

ClawX owns logical session identity and display metadata; cc-connect owns
runtime sessions and message history. Public session responses carry the
logical/runtime binding, while `cc-connect-session-metadata.json` stores only
optional display labels and never copies runtime credentials or message
history.

cc-connect Session REST/Management APIs are the only production source for
list, create, history, switch, and delete. Rename uses an official endpoint if
the pinned binary exposes it; otherwise ClawX stores only the display label in
its logical index and does not rewrite cc-connect private JSON. Hard delete is
reported successful only after the runtime API confirms deletion.

Runtime or provider switching preserves visible historical turns and detaches
the old backend binding. The first subsequent message creates a new runtime
session and includes a clearly identified continuation context once. OpenClaw
internal session ids are never passed to cc-connect.

Required cases include active, named, cross-Agent, Channel, Cron, restart,
rename, hard delete, and pagination. Session ids must not collide across
projects or provider accounts.

## 9. Token usage

Usage is a runtime contract, not a dashboard file scan.

```ts
interface RuntimeUsageRecord {
  id: string
  runtimeKind: RuntimeKind
  logicalSessionId: string
  runtimeSessionId: string
  turnId: string
  agentId: string
  providerAccountId?: string
  provider: string
  model: string
  timestamp: string
  status: 'available' | 'missing' | 'error'
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd?: number
}
```

Pinned cc-connect v1.4.1 does not currently expose per-turn token usage through
its documented Bridge or Management API, and an actual binary probe confirms
that enabling `reply_footer` does not add machine-readable usage to Bridge
replies. Therefore this acceptance row is **upstream-blocked**, not complete.
Production ClawX derives turn identity only from cc-connect public session
history. When that history has no usage payload, each assistant turn is
returned with `status: 'missing'` and zero counters so callers can distinguish
"the turn exists but usage is unavailable" from "there is no history". ClawX
does not fill those counters from private cc-connect stores or Codex JSONL.
Test code may use a managed transcript or provider response as an oracle, but
that evidence cannot close the exact-usage runtime-contract row.

The upstream audit was refreshed on 2026-07-12. npm still marks `1.4.1` as
`latest`; `1.5.0-beta.1` is prerelease. Both source trees parse Codex
`thread/tokenUsage/updated` into an internal `ContextUsageReporter`, but the
documented Management and Bridge session detail responses still expose only
message role/content/timestamp. When context display is enabled, the runtime
renders a lossy `[ctx: ~N%]` footer to the platform instead of a structured
per-turn payload. ClawX must not parse that display string or reach into
cc-connect's internal agent/session state. This is why upgrading to the beta or
enabling `reply_footer` does not close the contract.

Upstream PR [cc-connect#1428](https://github.com/chenhg5/cc-connect/pull/1428)
proposes an opt-in Bridge `usage` observer. It is useful directionally, but its
current head is conflicting and is not included in either published version.
Its unversioned event contains `session_key`, `turn_id`, input/output/cache
counts and user metadata, but omits `project`, provider/model identity,
reasoning tokens, durable history semantics and replay after reconnect. Those
omissions prevent reliable multi-Agent attribution and historical dashboard
reconstruction, so ClawX must not implement production parity against that
unmerged schema. A future release may use the observer design provided the
published contract addresses these fields or exposes an equivalent durable
Management history field.

Completion requires a pinned cc-connect release to expose a versioned usage
event or history field containing project, session/turn, provider/model, and
token counts, plus documented reconnect/replay behavior or durable history.
ClawX must then map that public payload to `RuntimeUsageRecord`, add a real
API-key/OAuth oracle comparison, and remove the checked-in E2E `fixme`.

`cachedInputTokens` is a subset of input and `reasoningTokens` is a subset of
output. If total is absent, calculate `input + output`; never add cache again.
Cost is shown only when runtime/provider returns an explicit historical value.
Dashboard defaults to the active runtime and offers OpenClaw, cc-connect, and
combined filters.

## 10. Channels and Feishu/Lark

Channel account metadata lives under `~/.clawx/app`; app secrets live in the
encrypted credential vault. Generated cc-connect TOML references environment
variables. Connect, disconnect, and delete mean config projection plus
Management API reload/status when the pinned binary lacks per-platform
lifecycle endpoints.

Feishu/Lark replacement evidence requires:

```text
tenant message -> cc-connect platform -> bound project/Agent/workspace
 -> Codex -> cc-connect -> tenant reply
```

Both China Feishu and global Lark domain mappings are tested. Status is read
from project platform detail, not inferred from process state. Channel-created
sessions must appear in ClawX history and usage under the bound Agent.

Channel mutations require account-scoped authorization. Runtime hooks may be
used as an evidence collector, not as a second message processor.

Current live-credential evidence proves the Feishu platform reaches
`connected`/`running` through cc-connect, survives Host API disconnect/connect
reload, preserves both the ClawX desktop administrator and configured Channel
administrators, removes the account from managed config on delete, and cleans
up the runtime process. A tenant-originated inbound marker and its reply remain
a separate manual gate; lifecycle success alone does not claim message-delivery
parity.

## 11. Cron

For the first replacement milestone, cc-connect native cron-expression jobs
are the only supported schedule kind. `at`, `every`, and manual run remain
explicitly unsupported unless the pinned stable binary exposes equivalent
native operations. ClawX must not maintain a second prompt scheduler.

GUI and Channel `/cron` operate the same cc-connect scheduler and store:

- Channel create/update/enable/disable/delete is visible in GUI.
- GUI mutations are visible through Channel `/cron`.
- Scheduled prompt execution returns to the configured Channel through
  cc-connect.
- `admin_from` contains ClawX admins and explicit `cron-manager` role members;
  other allow-listed users cannot mutate jobs.
- Jobs carry project, session key, workspace, schedule, enabled state, and
  runtime ownership.

For prompt/exec jobs without external delivery, ClawX uses the managed local
LINE placeholder session key because cc-connect Cron resolves the first session
key segment as a configured platform. Agent/account/workspace ownership still
comes from the job's project. `clawx:<agent>:<session>` remains a Bridge session
key and must not be passed to the native scheduler. Announce jobs use the real
target platform and recipient key.

Capability metadata exposes `scheduleKinds: ['cron']`, Channel commands, and
the actual support state of manual execution. Unsupported operations are
non-mutating.

Current real-runtime evidence covers both native scheduler paths with the
bundled cc-connect binary. An enabled exec job fired on an actual minute tick
and wrote its marker from the configured `work_dir`. A Codex OAuth prompt job
also fired on an actual minute tick, entered cc-connect through the managed
project, and exposed its prompt and assistant reply through the public
session-summary/history APIs. The evidence command is
`pnpm run verify:cc-connect:local-real:scheduled-cron`; it does not claim live
tenant-channel delivery, which remains a separate Feishu/Lark credential gate.

## 12. Health, Doctor, and logs

Runtime ready requires a live process, Management API, Bridge registration,
loaded projects, executable Agent binary, valid required workspace, and scoped
credential checks. A single expired Agent account degrades that Agent rather
than the whole runtime.

`checkHealth({ probe: true })` verifies the child is still alive, the Bridge
WebSocket is currently registered, and every projected project is readable
through Management API. Infrastructure probe failures return `ok: false` with
the failed component; account support/auth diagnostics stay project-scoped so
one invalid account does not mark unrelated Agents unhealthy.
Message preflight resolves the target Agent from the logical session key and
checks that project's provider profile. An invalid default account therefore
does not block an Agent with a valid explicit binding, and an invalid explicit
binding blocks only that Agent before any Bridge message is sent.
Agent create, rename, model/account binding, Channel binding, and delete
operations notify the active runtime. In cc-connect mode they rebuild or
restart cc-connect projects without invoking OpenClaw auth/model projection;
OpenClaw keeps its existing projection and reload behavior.
Skills are sourced from the shared ClawX/OpenClaw-compatible skill registry and
mirrored into every distinct Codex home used by current cc-connect projects.
Runtime start, skill enable/disable, and ClawHub install/uninstall all refresh
every project home, so account isolation does not split skill availability.

Startup order is data lock/version, managed config, skills, binary validation,
process, Management API, Bridge, projects, health, ready. Intentional stop
drains or cancels runs before terminating the process tree. Unexpected crashes
use bounded backoff and eventually enter error state.

Bridge registration is part of startup, not a background best effort. If the
process starts but Bridge registration fails, the provider closes registered
and in-flight WebSockets, terminates the managed process tree, reports `error`,
and leaves no child running. Stop/restart closes sockets that are still waiting
for `register_ack` and suppresses any reconnect scheduled by that close.

Main captures cc-connect stdout/stderr, redacts scoped provider/channel secrets
and common bearer/API-key forms before emission, keeps a bounded in-memory tail,
and writes mode-0600 `runtimes/cc-connect/logs/runtime.log` with size rotation.
Runtime diagnostics combine that stream, matching ClawX manager lines, and a
redacted managed config. Renderer never reads the process pipe or log path
directly.

cc-connect Doctor runs native `doctor user-isolation` against managed config
and stores its JSON audit. `doctor.fix` is unsupported in cc-connect mode and
is hidden/disabled. Runtime-neutral Settings strings must not report an
OpenClaw Doctor result for cc-connect.

cc-connect stdout, stderr, structured events, and doctor audits are captured
under `~/.clawx/logs/runtimes/cc-connect` with rotation and pre-write secret
redaction. Diagnostics use the active provider and must not include OpenClaw
gateway logs as cc-connect runtime logs.

## 13. Migration and rollback

Migration steps:

1. Create and lock `~/.clawx` layout.
2. Import ClawX application settings and provider accounts from legacy
   Electron userData.
3. Register existing OpenClaw workspaces as external paths.
4. Encrypt provider secrets and create account-level OAuth homes.
5. Move ClawX-owned cc-connect data from legacy userData into the new runtime
   directory.
6. Build logical session projection without modifying runtime stores.
7. Start the selected runtime only after migration commits.

Rollback means selecting OpenClaw, stopping cc-connect, and preserving its
managed data. Rollback never deletes credentials, sessions, workspace, or
cc-connect config. A migration failure restores the backup and leaves the prior
data version writable by the prior application.

## 14. Delivery phases and evidence gates

| Phase | Goal and implementation | Required verification | Impact |
| --- | --- | --- | --- |
| A. Contract and dependency | Pin/probe stable cc-connect; add runtime contracts and API client | Binary contract test, bundle manifest, type/unit tests | Shared types; no behavior switch |
| B. Data root and credentials | Add layout, writer lock, migrations, encrypted vault, OAuth homes | vN to vN+1 and rollback packaged run; two-instance lock; secret scan | All persistent paths |
| C. Workspace and skills | Registry, OpenClaw reuse, project `work_dir`, shared skill projection | Two-Agent isolation; real skill invocation; source-checkout negative test | Agent create/delete and files |
| D. Bridge chat/events | Official Bridge send, tools, approvals, cancellation, replay | Real API-key and OAuth tool-heavy chats; disconnect/replay; screenshots | Core communication path |
| E. Sessions and usage | Official APIs, logical binding, per-turn usage | Named/cross-Agent/Channel/restart/delete; token oracle comparison | Sidebar, history, Models |
| F. Channels and cron | Feishu/Lark full path; one native scheduler for GUI and Channel | Tenant inbound/reply; Channel/GUI Cron bidirectional CRUD and scheduled reply | Channel and Cron surfaces |
| G. Health and diagnostics | Scoped health, native doctor, real logs | Crash, port conflict, expired auth, doctor audit, log redaction | Settings and diagnostics |
| H. Packaging and release | Offline resources and platform smoke | Source bundle integrity; `afterPack` target verification; final macOS x64/arm64, Windows x64, Linux x64/arm64 resource checks; native Electron/Host API/runtime startup, Cron/Doctor, rollback, PID/port/process cleanup | Build/release only |

Every phase must produce code-level route evidence and actual runtime evidence
under `artifacts/cc-connect/<run-id>/`:

- `api/`: sanitized requests and responses.
- `logs/`: ClawX, cc-connect, Bridge, doctor, and scheduler excerpts.
- `screenshots/`: ClawX and Channel UI evidence.
- `fs/`: sanitized manifests, workspace trees, and migration checks.
- `report.json`: acceptance row, command, status, evidence paths, and gaps.

Mock-only evidence cannot close a real-runtime row. Opt-in credentials may stay
outside normal CI, but replacement readiness remains partial until the latest
report contains PASS evidence for real OAuth, external OpenAI API key, Feishu
inbound/reply, native Channel Cron, and packaged target platforms.

Deterministic Electron evidence covers same-account browser re-login projection
and protects Codex-refreshed managed auth from stale-vault rollback. A live
expired-token refresh failure followed by browser re-login still requires an
explicit real OAuth fixture and remains an external validation row.

## 15. Acceptance and explicit non-parity

cc-connect replacement is complete only when:

- No cc-connect Chat, session, tool, approval, cancellation, or usage path
  launches or talks to Codex outside cc-connect.
- No shared cc-connect service writes OpenClaw config or cc-connect private
  session files.
- GUI Chat, Feishu/Lark, and native Cron all execute through cc-connect and the
  bound Agent/account/workspace.
- OpenAI OAuth and API-key modes pass real end-to-end tests with account
  isolation.
- Session/history/title/delete and token usage match the shared runtime
  contract across Agent and Channel cases.
- Skills are actually invoked, health/Doctor/logs are runtime-aware, and
  packaged applications run offline.
- Required logs and screenshots exist and sensitive-data scans pass.

Accepted non-parity for the first milestone:

- cc-connect remains behind Developer Mode.
- cc-connect Doctor Fix does not replace OpenClaw Doctor Fix.
- Only native cron expressions are supported; `at` and `every` are not
  emulated.
- Real credential and all-platform release checks remain opt-in until a
  separate CI policy decision.

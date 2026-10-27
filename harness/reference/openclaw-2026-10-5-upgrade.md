# OpenClaw 2026.10.5 upgrade reference

Durable, non-executable reference for the ClawX kernel upgrade from
`openclaw@2026.7.1-2` to `openclaw@2026.10.5`.

## Runtime matrix

| Component | Before | After | Constraint |
| --- | --- | --- | --- |
| openclaw | 2026.7.1-2 (CJS, 4597 `.js` chunks) | 2026.10.5 (ESM, 8175 `.mjs` chunks, `type: module`) | Node `>=24.16.0 <25 \|\| >=26.1.0` |
| @openclaw/ai | 2026.7.1-2 | 2026.10.5 | pinned by openclaw |
| @openclaw/discord | 2026.7.1 | 2026.10.5 | peer `openclaw >=2026.7.1` |
| @openclaw/whatsapp | 2026.7.1 | 2026.10.5 | peer `openclaw >=2026.7.1` |
| @openclaw/qqbot | 2026.7.1 | 2026.7.1 | no newer published release |
| @wecom/wecom-openclaw-plugin | 2026.8.17 | 2026.9.15 | local compatibility patch regenerated |
| @tencent-weixin/openclaw-weixin | 2.4.8 | 2.4.10 | |
| @dingtalk-real-ai/dingtalk-connector | 0.8.25 | 0.8.26 | |
| Feishu/Lark plugin | @larksuite/openclaw-lark 2026.7.16 | **@openclaw/feishu 2026.10.5** | official successor; old plugin fails on >=2026.8.1 |
| electron | 40.10.6 (Node 24.15.0, SQLite 3.51.3) | 41.10.7 (Node 24.18.0, SQLite 3.53.1) | Node floor |
| bundled Windows Node | 22.22.3 | 24.18.1 | Node floor |
| @agentclientprotocol/sdk | 1.1.0 | 1.7.0 | matches openclaw 2026.10.5 |

`2026.10.5` is the npm `latest` tag. `2026.10.10-beta.1` is `beta`;
`2026.9.33` is `extended-stable`.

## Why Electron and Windows Node must move

`openclaw.mjs` in 2026.10.5 hard-exits with:

- `Node <v> is unsupported; OpenClaw requires >=24.16.0 <25, or >=26.1.0 (Node 26 recommended).`
- `this OpenClaw release requires Node >=24.16.0 <25 || >=26.1.0.`

Electron 40 embeds Node 24.15.0, one patch below the floor, so every packaged
macOS/Linux Gateway launch would fail. Electron 41.10.7 embeds Node 24.18.0 and
SQLite 3.53.1 (WAL-reset-safe). Windows packaged builds spawn the separately
downloaded `resources/bin/win32-*/node.exe`, which is now 24.18.1.

Development mode uses the developer's `node` from `PATH`; it must be
`>=24.16.0` (or `>=26.1.0`), not Node 22/23/25.

## 2026.10.5 packaging changes that affect ClawX

1. **ESM output.** `package.json` is `"type": "module"`; runtime chunks are
   `.mjs`. `dist/entry.js` still exists. ClawX's self-import rewrite and
   browser-hint patch must scan `.mjs`; the PTY hardening must target
   `terminal-pty-*.mjs` and `bash-tools-*.mjs`.
2. **Node floor raised in 2026.9.3** for the `node:sqlite` embedded-NUL TEXT
   decoder fix (nodejs/node#61954).
3. **ACP translator refactor.** `AcpGatewayAgent` became
   `AcpTranslatorAgentEvents` + `AcpTranslatorPromptStream` +
   `AcpTranslatorSessionLifecycle` + `AcpTranslatorSessionUpdates` in
   `dist/server-*.mjs`. The 2026.7.1 patch hunks no longer apply and must be
   re-derived.
4. **Compaction events evolved.** Upstream now emits `stream: "compaction"`
   events with `outcome` objects, but still does not emit the ACP
   `session_info_update` projection, compaction ids/timestamps, or the
   `session.operation` broadcast that ClawX consumes.
5. **Bundled extension set changed.** `imessage` is no longer a bundled
   channel extension; `telegram` still is. External channel plugins remain
   separate packages. `dist/extensions/acpx` is no longer shipped; ClawX still
   bundles the `acpx` npm runtime.
6. **`OPENCLAW_VERSION` moved** from `openclaw/plugin-sdk/agent-harness` to
   `openclaw/plugin-sdk/agent-harness-runtime`.
7. **Package size grew** from ~19 MB to ~103 MB compressed (273 MB unpacked),
   so bundle/package time and disk usage increase.

## ClawX runtime patch port map (2026.7.1-2 → 2026.10.5)

The 2026.7.1-2 patch touched 30 generated files. New homes and port status:

| Feature | Old chunk | 2026.10.5 target | Status |
| --- | --- | --- | --- |
| TokenDance recovery header | `errors-sMD712F3.js` | `error-coercion-*.mjs` | ported |
| ACP compaction update projection | `acp-cli-*.js` | `server-*.mjs` | ported (function + agent stream + session.operation) |
| ACP tool/toolCall/compaction replay | `acp-cli-*.js` | `server-*.mjs` `extractReplayChunks` | ported |
| ACP snapshot-aware delta/text snapshot | `acp-cli-*.js` | `server-*.mjs` | ported |
| Manual compaction operation metadata | `sessions-*.js` | `sessions-compact-*.mjs` | ported |
| Compaction cut point (`keepRecentTokens: 0`) | `proxy-*.js` | `agent-core-*.mjs` `prepareCompaction` | ported |
| Compaction config schema | `zod-schema-*.js` | `zod-schema-*.mjs` | ported (`.min(0)`) |
| Settings keepRecentTokens=0 | `agent-settings-*.js` | `agent-settings-*.mjs` | ported |
| No-tail boundary hardening | `compact-*.js` | upstream removed `hardenManualCompactionBoundary` | obsolete |
| Compaction ids/timestamps | `selection-*.js` | `builtin-openclaw-*.mjs` | ported |
| ACP ambient/subagent streaming | `acp-cli-*.js` | `server-*.mjs` new prompt stream | ported (session message subscriptions, replay buffer, ambient tool/thought/chat) |
| Restart-recovery run lineage | `agent-*.js`, `agent-events-*.js` | upstream 2026.10.5 | upstreamed, patch dropped |
| Main-session restart recovery | `main-session-restart-recovery-*.js` | upstream `main-session-restart-recovery-*.mjs` | upstreamed |
| `session.operation` broadcast | `sessions-*.js` | `sessions-compact-*.mjs` | manual compaction metadata ported |
| Chat `resumedFromRunId` projection | `server-chat-*.js` | upstream recovery lineage | obsolete |
| Approval run/tool identity | `exec-approval-*.js`, `schema-*.js` | upstream approval records | upstreamed |
| Aggregate tool-result pressure target | `attempt.tool-run-context-*.js`, `selection-*.js` | upstream pressure rework | obsolete |
| bash tool run/tool ids | `bash-tools-*.js` | upstream tool-run context | upstreamed |
| Provider terminal error text | `server-chat-*.js`, `agent-*.js` | `server-*.mjs` ACP error terminal | ported |

ClawX must not carry the 2026.7.1-2 patch forward by filename: the task spec
`recover-acp-session-after-gateway-restart.md` explicitly requires regenerating
generated-dist patches for every OpenClaw version change.

## Compatibility expectations

- **Backward:** upgrading from a 2026.7.1 state tree preserves config, auth
  profiles, session SQLite files plus WAL/SHM, channel credentials, and
  ClawX-managed model selections. The pre-migration snapshot covers
  `openclaw.json`, `state/`, per-agent `auth-profiles.json` and SQLite files.
- **Forward:** state written by a newer OpenClaw release must be reported, not
  rewritten. Unknown config keys are preserved by the sanitizer.
- **Cross-platform:** every platform forks `openclaw.mjs` in an Electron
  `utilityProcess` through the ClawX bootstrap described below; Windows also
  prepends `resources/bin/win32-*` (bundled `node.exe`) to `PATH` for tools.
  The embedded and bundled Node runtimes must satisfy the Node 24.16 floor.

## Utility-process bootstrap

OpenClaw 2026.10 re-executes its own runtime (`process.execPath`) with
`spawn`, `spawnSync`, `execFile`, and `execFileSync` for SQLite readers,
state/database preflight, migrations, and tool hosts. Inside an Electron
`utilityProcess` that binary is the ClawX Helper, and Electron only rewrites
`child_process.fork()` to run as Node. Every other re-exec booted a second
ClawX app, so the Gateway failed at `cli.bootstrap.admission.state-snapshot`
with the generic `The CLI command failed.` (exit 1) instead of OpenClaw's real
diagnostic. Electron's own `fork()` rewrite (set `ELECTRON_RUN_AS_NODE=1`, use
`process.helperExecPath` on macOS) only applies when the module path is a
string, while OpenClaw forks its SQLite integrity, preflight, and verify
workers from `file:` URL objects. Those workers also booted ClawX, so
`doctor --fix` skipped every agent database (`media-persistence
(step-refused)`) after migrating only the state database. Setting
`ELECTRON_RUN_AS_NODE` on the utility process itself breaks the utility
process, so it is not an option.

`electron/utils/openclaw-utility-process.ts` writes
`<userData>/openclaw-utility-bootstrap.mjs` and
`<userData>/openclaw-runtime-compat.mjs`, then forks the bootstrap instead of
the entry. The bootstrap imports the compatibility module before loading the
entry. The compatibility module injects `ELECTRON_RUN_AS_NODE=1` and its own
`--import` preload into re-execs whose command is `process.execPath`, including
callback and `promisify.custom` variants. It also patches `fork()` and
`worker_threads.Worker`, so OpenClaw's spawn-broker children and nested SQLite
workers remain in Node mode even when they pass an explicit environment or
`execArgv: []`. File-URL module paths passed to `fork()` are converted to
paths so Electron's rewrite applies. `syncBuiltinESMExports()` keeps ESM named
imports aligned with the patched builtins, while the parent utility process
itself remains a normal Electron utility process.

The Gateway, the startup doctor repair, Settings → Run Doctor, and Control UI
device pairing all launch through `forkOpenClawUtilityProcess`.

## First launch on 2026.7.1 state

OpenClaw 2026.10.5 refuses to admit a 2026.7.1 state tree until an offline
`doctor --fix` migrates the state database, every agent database, and legacy
config keys. The Gateway may exit with code 78 or, in packaged utility-process
launches, collapse the same admission failure to a generic code 1 with
`The CLI command failed`. `startup-recovery.ts` treats the explicit diagnostics
and the startup-only code 1 as a bounded config-repair opportunity, so the
orchestrator runs one doctor repair (10-minute timeout for large agent
databases) and relaunches. Pre-2026.10 agent registries
store absolute paths, so doctor writes `.bak` copies next to the original
agent databases; sandboxed reproductions must not copy that state without
accounting for it. Legacy managed outgoing image records also store absolute
`original.path` values that must sit under `<stateDir>/media/outgoing/originals`,
so a relocated copy fails `managed-outgoing-images` unless those records are
rewritten to the copy's location. Doctor's console summary redacts from the
first path to the end of the line; the structured OpenClaw file log
(`/tmp/openclaw/openclaw-<date>.log`, `%TEMP%\openclaw\` on Windows) keeps
per-step progress and is exported under `logs/openclaw-runtime/` in issue
reports.

### Windows: koffi and the state snapshot

On Windows, OpenClaw stages state-database read snapshots under a private
directory (`%LOCALAPPDATA%\openclaw`) created through koffi
(`dist/windows-private-directory-*.mjs`). If koffi cannot load, both the
Gateway admission snapshot and Doctor's maintenance entry fail. The Gateway
prints only `The CLI command failed.` and exits 1, which ClawX treats as a
config-repair opportunity. Doctor then reports `Doctor could not enter
maintenance. AggregateError: Shared-state read and cleanup failed`. The
actual cause is visible only as `DoctorUnreadableStateDatabaseError ...
Cannot find module './src/koffi/index.cjs'` in the runtime log. The 2026-10-27
0.6.1 → 2026.10.5 Windows in-place upgrade failure was this: the bundle
cleanup deleted `koffi/src`, which koffi 3.x uses for its JavaScript entry.
macOS does not take this path, so it cannot reproduce the failure. ClawX runs
OpenClaw children with `OPENCLAW_DEBUG=1`, and the compatibility shim
expands `AggregateError` entries and causes, so this class of failure now
appears in the ClawX log as `[Gateway stderr]` / `[Gateway doctor stderr]`
`Reason:` and stack lines.

## 2026.10 config shape written by ClawX

| 2026.7.1 key | 2026.10.5 shape |
| --- | --- |
| `tools.exec.security` / `tools.exec.ask` | `tools.exec.mode: "full"` |
| `skills.workshop.autonomous.enabled` | `skills.workshop.autonomous.mode: "off"` |
| `agents.defaults.compaction.identifierPolicy: "custom"` | `"strict"`; `identifierInstructions` and `reserveTokensFloor` are retired |
| `session.idleMinutes` | `session.reset: { mode: "idle", idleMinutes }` |
| `agents.defaults.memorySearch` | root `memory.search` (per agent: `agents.entries.<id>.memory.search`) |
| `agents.defaults.imageGenerationModel` | `agents.defaults.mediaModels.image` |
| `agents.defaults.mediaGenerationAutoProviderFallback` | retired; an explicit `mediaModels.image` disables auto fallback |
| `agents.list[]` with `default: true` | keyed `agents.entries`; two or more agents also set `agents.ownership: "explicit"` and `agents.defaults.systemAgent.agentId` |

ClawX's auth sync opens `agents/<id>/agent/openclaw-agent.sqlite` before
every Gateway start. That database is OpenClaw's agent database, and
2026.10.5 admits it only at `user_version` 25 with `schema_meta.schema_version`
25. Stamping ClawX's historical version 1 over an OpenClaw-owned database
(one whose `schema_meta.app_version` is set) makes the Gateway exit 78 with
`uses schema version 1`, after which doctor refuses to migrate a database
that was already migrated. Auth sync must keep or restore version 25 for
those databases and may still create a version 1 database only when ClawX
itself creates the file.

Before Gateway launch, ClawX migrates the known schema-preserving legacy keys
(`agents.list`, `meta.lastTouchedAt`, and the legacy memory-search locations) and
removes the retired `mediaGenerationAutoProviderFallback` flag. OpenClaw Doctor
continues to handle state/database migration and any legacy or user-authored
keys outside this safe prelaunch set, including `plugins.bundledDiscovery`,
`commands.ownerDisplay`, and `tools.media.image.models`.


## Packaging evidence (2026.10.5)

Local packaging was exercised for every desktop target on a macOS arm64 host:

| Target | Result | Evidence |
| --- | --- | --- |
| macOS arm64 directory build | pass | `release/mac/ClawX.app` assembled; signed with the local Developer ID; Playwright smoke reports `main-layout` visible and Electron `41.10.7`; packaged `openclaw.mjs` booted through the `ClawX Helper` (Node 24.18.0 / SQLite 3.53.1) and `/health` returned `{"ok":true,"status":"live"}` |
| macOS dmg/zip + notarization | blocked by credentials | builder stops at `APPLE_APP_SPECIFIC_PASSWORD env var needs to be set`; release CI supplies it |
| Linux arm64 directory build | pass | `release/linux-arm64-unpacked/resources/openclaw` is 2026.10.5 with the ClawX patch; all 7 plugin mirrors present |
| Windows arm64 directory build | pass | `release/win-arm64-unpacked/resources/openclaw` is 2026.10.5 with the ClawX patch; `resources/bin/node.exe` is `PE32+ Aarch64` Node `v24.18.1`; all 7 plugin mirrors present |
| Windows NSIS installer | not run on macOS | requires the Windows CI runner (`package-win-manual.yml`) |
| Gateway under Electron `utilityProcess` | pass with bootstrap | dev Electron `41.10.7` forked the packaged 2026.10.5 `openclaw.mjs` against a migrated state copy: without the bootstrap it exits 1 with `The CLI command failed.` after `state-snapshot`; with the bootstrap `/health` returned `{"ok":true,"status":"live"}` and `doctor --json` returned a structured report |
| `doctor --fix` under Electron `utilityProcess` | pass with bootstrap | `fork(fileURL)` crashes the child without the URL conversion; with it, doctor migrated a partially migrated 2026.7.1 state copy (all four agent databases v1 → v25, exit 0) and the packaged Gateway then reported `/health` live |

The Helper-direct row above ran `openclaw.mjs` with `ELECTRON_RUN_AS_NODE=1` set
on the Helper itself, which bypasses ClawX's `utilityProcess` launch path and
therefore did not catch the re-exec failure.

The Windows directory build cannot extract the DingTalk `dws` payload on a
non-Windows host (`spawnSync powershell.exe ENOENT`); the Windows CI runner
performs that step natively.

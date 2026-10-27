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
| QQ Bot plugin | @openclaw/qqbot 2026.7.1 | **@tencent-connect/openclaw-qqbot 2.0.3** | the 2026.10.5 catalog provider for `qqbot`; plugin id `openclaw-qqbot` |
| @tencent-connect/qqbot-connector | ^1.1.0 | 1.2.0 | exact peer and dependency of Tencent QQBot 2.0.3 |
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
  Main agent credentials move to the shared state database (see
  [Shared auth profile store in 2026.10](#shared-auth-profile-store-in-202610)).
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
device pairing all launch through `forkOpenClawUtilityProcess`. The ACP chat
process is a `child_process.fork` of `openclaw.mjs` and loads the
compatibility module with `--import` instead.

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

### Windows: plugin capture recovery junctions

OpenClaw 2026.10 loads each plugin module from a private "capture" copy under
`%TEMP%\openclaw-plugin-captures-*` or `~/.openclaw/tmp/plugin-captures`. Each
dependency package gets its own `package-N` directory, linked back with
`fs.symlinkSync(..., "junction")`. Doctor contracts, setup entries, and the
runtime loader then fork a recovery copy of that capture.
`copyRecoverySource` (`plugin-generation-source-lookup-*.mjs`) does this with
`fs.cpSync(..., { verbatimSymlinks: true })`, and that breaks on Windows:

- Node's `cpSync` recreates every link with an untyped `symlinkSync`. On
  Windows that is a `dir` or `file` symlink, which a standard user without
  Developer Mode cannot create. The failure is
  `EPERM: operation not permitted, symlink '<old build>\package-1\node_modules\<dep>' -> '<new build>\package-0\node_modules\<plugin>\node_modules\<dep>'`.
- Junctions store absolute targets. Even with symlink privilege, the copied
  link would point into the old build, which is disposed afterwards. POSIX
  captures use relative links, so `verbatimSymlinks` relocates them.

This affects every plugin with a nested `node_modules` dependency, which is
every ClawX channel mirror. On the 2026-10-27 0.6.1 → 2026.10.5 Windows
in-place upgrade, Doctor (started for `audit-events-v2`) reloaded the Feishu
and QQ Bot doctor contracts about 20 times. Each attempt copied the 86 MB
Feishu tree and then threw it away. Doctor was still running after six and
a half minutes while the UI showed only `connecting`. OpenClaw issue
[#163139](https://github.com/openclaw/openclaw/issues/163139) is the same
failure on `plugins.reload` and `plugins install`. ClawX's own junctions,
such as the `node_modules/openclaw` peer link, work on the same machine.

The ClawX patch adds `copyWindowsRecoveryJunction` to the recovery copy. On
win32, a directory link (or a dangling one, whose target is not materialized
yet) is recreated as a junction. Targets inside the copied build are relocated
into the recovery build, and targets outside it (host `openclaw`, native
admission content) are kept as-is. File links and native references keep the
existing `cpSync` and hardlink handling, and other platforms are unchanged.

macOS reproduces the failure with a preload that applies Windows semantics:
it stores junction targets as absolute paths and rejects untyped capture
symlinks with `EPERM`. On a synthetic home with the four ClawX channel
mirrors, `doctor --fix` without the patch logs 21 Feishu contract or
legacy-migration failures and takes 498 s. With the patch it logs no `EPERM`,
no contract failures, and no cross-build links, and takes 156 s, about the
same as native macOS (110–150 s). Running Doctor from the repository's
symlinked `node_modules/openclaw` also fails with
`Unable to open bundled plugin public surface msteams/config-doctor-api.js`.
That is a dev-layout artifact; Doctor from the real `build/openclaw`
directory completes.

On the same machine, the failed Doctor runs never imported the legacy
`agents/main/sessions/sessions.json`. A later Gateway start then admitted the
main agent database as degraded (`Sessions remain unavailable`). Cron
maintenance, memory-core dreaming cleanup, and session reads failed every
minute with `Legacy session store requires migration`. A Doctor run that
completes imports the store, so this failure needs the junction fix and does
not need a separate session-store repair.

### Windows: console windows from runtime re-execs

OpenClaw re-executes `process.execPath` without `windowsHide`, for example in
the SQLite read-only workers (`sqlite-readonly-worker-*.mjs`,
`sqlite-readonly-worker-session-*.mjs`) and the agent database verify
(`openclaw-agent-db-readonly-open-*.mjs`). On packaged Windows, the ACP
process runs on the bundled console-subsystem `node.exe` and is forked with
`windowsHide: true`. Windows does not attach a console to it, so each console
child it starts without `windowsHide` gets a new visible console. Loading
history spawns those readers, so a black window appeared every time a
conversation opened. The Gateway and Doctor run in an Electron utility process
(GUI subsystem), and their console children (`node.exe`, `git`, `cmd`) have
the same exposure.

The runtime compatibility shim defaults `windowsHide: true` on `spawn`,
`spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`, and `fork`
(including the `promisify.custom` variants). An explicit `windowsHide: false`
is kept. `getOpenClawEmbeddedForkSpec` preloads the same shim into the ACP
fork with `--import`, so ACP's children inherit both the hidden-window default
and the preload. The option has no effect on macOS and Linux.

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


## Plugin install index in 2026.10

OpenClaw 2026.10 stores the installed-plugin index as the
`plugins.installedIndex` row of `config_machine_state` in
`state/openclaw.sqlite`. The value is `{ revision, index }`, and `index`
carries `installRecords`, `plugins` projections, and diagnostics. OpenClaw
imports the older `installed_plugin_index` table only while migrating a
database below `user_version` 13, and then drops it. Writing that table into
a migrated database has no effect.

`electron/utils/plugin-install-index.ts` therefore writes:

- **Migrated databases** (`user_version` ≥ 13 with `config_machine_state`):
  the machine-state row. The write runs inside `BEGIN IMMEDIATE` and is skipped
  while OpenClaw holds the `core:plugin-lifecycle` / `global` state lease. An
  invalid row is left for Doctor. The revision becomes
  `max(now, previous + 1)`. The cached `plugins` projections of changed records
  are dropped so OpenClaw rebuilds them. A stray `installed_plugin_index` table
  recreated by earlier ClawX builds is dropped.
- **Fresh or pre-13 databases:** the legacy table, which OpenClaw imports
  during its schema migration.

Records that differ only in `installedAt` are not rewritten. Existing
`acceptedSurface*` capability consent is preserved, because OpenClaw
re-checks it against the declared surface hash.

## Shared auth profile store in 2026.10

OpenClaw 2026.10 moves the main agent's credentials (the shared store that
every agent merges with) out of `agents/main/agent/openclaw-agent.sqlite`.
They go into `config_machine_state` in `state/openclaw.sqlite`, under the rows
`authProfiles.store` and `authProfiles.state`. Their `value_json` has the same
JSON as the agent database's `store_json` / `state_json`. The owner marker
`auth.sharedStore` is `{"location":"state-db"}` after relocation. With no row,
or with `legacy-main`, the store is still in the main agent database. Doctor
relocates an upgraded store and reports `Relocated shared auth profiles into
shared SQLite state`. A fresh 2026.10 home is `state-db` from the start. Once
the owner is `state-db`, OpenClaw ignores the main agent database rows.

OpenClaw also treats an exact-named `auth-profiles.json` (or `auth-state.json`
/ `auth.json`) next to an auth store as an unmigrated source. For the shared
main directory, it checks that file against the main agent database. With
`state-db`, the file therefore blocks every provider it names, even when the
shared store has the key: `AUTH_PROFILE_MIGRATION_REQUIRED ... affected
providers: ...; run openclaw doctor --fix`. Earlier ClawX builds wrote the main
agent database and a JSON compatibility copy on every key save. After the
2026-10-27 0.6.1 upgrade, OpenClaw saw custom provider keys as missing, and
the UI reported that no API key was configured.

`electron/utils/openclaw-auth-sqlite.ts` follows the owner marker for `main`:

- **`state-db`:** read and write the two shared-state cells inside
  `BEGIN IMMEDIATE`, and recheck the owner inside the transaction.
- **No row or `legacy-main`:** keep using the main agent database, which
  Doctor relocates later.
- **Invalid marker:** refuse auth writes and leave the marker for Doctor.

After a successful SQLite write, ClawX renames `auth-profiles.json` to
`auth-profiles.json.clawx-retired-<ms>`. That keeps a stale copy from blocking
OpenClaw or bringing a deleted key back. While the agent database still waits
for OpenClaw's schema migration, ClawX keeps writing the JSON, which Doctor
imports. At startup, a leftover JSON next to a `state-db` store is merged
into the shared cells. Only profiles and `order` / `lastGood` entries missing
from the shared store are added, so a newer shared key wins. The JSON is then
retired.

Evidence on synthetic homes with OpenClaw 2026.10.5 under Electron's Node
24.18.0:

1. **Fresh home:** a ClawX key save wrote only the shared cells, and
   `models auth list` listed the profile.
2. **Pre-2026.10 owner (marker removed):** ClawX saved to the main agent
   database. Doctor relocated the store and archived a 0.6.1-style JSON. ClawX
   then read the key from the shared store, and a rotation reached OpenClaw.
3. **Stale JSON after relocation:** OpenClaw failed with
   `AUTH_PROFILE_MIGRATION_REQUIRED` for both named providers. After ClawX's
   startup migration, the shared key kept its rotated value, the JSON-only
   provider was imported, and `models auth list` succeeded.

## Capability consent for ClawX mirrors

Path-owned ClawX mirrors (DingTalk, WeCom, Feishu, QQ Bot, the OpenAI image
relay) are never `trustedOfficialInstall`. Without an accepted surface,
`openclaw plugins list` reports `requires capability consent` for each of them.
The warning comes from the status snapshot only, and the Gateway still loads
the plugin. The npm-recorded official mirrors (Discord, WhatsApp, Weixin) are
trusted and never warn.

The accepted surface hash is computed from OpenClaw's normalized manifest
metadata, not from the raw `openclaw.plugin.json`. For example, WeCom's
accepted tools include `wecom_mcp`, which its manifest does not declare. No
public OpenClaw export or read-only CLI output reproduces that surface:
`plugins list --json` is a display projection without skills, and
`plugins inspect --json` takes about 60s. ClawX therefore never writes the
acceptance fields itself.

`electron/utils/plugin-capability-consent.ts` runs
`openclaw plugins enable <ids...> --accept-capabilities` in prelaunch, after
install records are final and before Gateway start. A running Gateway would
apply the change through `plugins.setEnabled` and its runtime lifecycle, which
can restart the channel.

- **Scope.** The CLI runs only for ClawX path-owned mirrors that are installed,
  recorded at the ClawX mirror path, and explicitly enabled and allowed in
  config. `plugins enable` must never turn on a plugin the user left off.
- **Cost.** Each id costs a full metadata scan, config write, and registry
  refresh, about 9s on Apple Silicon (46s for all five). ClawX caches a
  per-plugin fingerprint (OpenClaw version plus record version, install path,
  and `installedAt`) in `plugin-capability-consent-cache.json` under userData.
  The CLI runs again only when a mirror is installed or upgraded, or when the
  runtime changes. The cached path takes about 10ms.
- **Failures.** The CLI stops at the first failing id, so a non-zero batch is
  retried one id at a time. A timeout is not retried. Each fingerprint is
  attempted once, so a persistent failure leaves only the status warning and
  does not slow every launch.
- **Config side effects.** OpenClaw rewrites `openclaw.json` through its own
  writer. It moves the accepted `plugins.entries` keys to the end, adds `meta`,
  and rotates `.bak` files. Allowlists are preserved in CLI mode.

Evidence from a synthetic OpenClaw 2026.10.5 home with all ClawX mirrors
installed through ClawX's own install code:

1. The five path-owned plugins reported consent warnings.
2. One prelaunch call recorded acceptance for all five in 46s, and the second
   launch was a cache hit.
3. A ClawX relaunch that re-synced records kept the acceptance.
4. `config validate` stayed valid, and the Gateway reached `ready` with no
   consent diagnostics.

## Channel plugin migration for 0.6.1 upgrades

- **QQ Bot.** The 2026.10.5 catalog serves `qqbot` from Tencent QQBot 2.0
  (`legacyNpmPackageNames: ["@openclaw/qqbot"]`). The host schema forbids
  `defaultAccount` and `accounts.default`, and requires a non-wildcard
  `allowFrom` at the root and in every account. A 0.6.1 config fails
  `openclaw config validate`. Before launch, ClawX moves `accounts.default` to
  the root, or keeps a mirrored named default first because Tencent uses the
  first account when the root has no credentials. It then applies Doctor's
  `qqbot.tencent-2.0-compatibility` allowlist rule, replacing an open or
  wildcard `allowFrom` with explicit IDs or `openclaw:approval-disabled` plus
  `dmPolicy: "open"`. Activation moves from `qqbot` to `openclaw-qqbot`, and
  the install record becomes a path record under `openclaw-qqbot`. Approval,
  `clientSecretFile`, streaming-transport, group command, and
  `commands.allowFrom` policies stay for OpenClaw Doctor. ClawX reads the
  Tencent shape back into its account model before mutations, and rejects a
  named default while a `default` account exists because Tencent cannot
  represent that state. The bundlers skip only peer dependencies that are not
  also runtime dependencies, because `@tencent-connect/qqbot-connector` is
  both.
- **Feishu.** `sanitizeOpenClawConfig` runs before plugin maintenance, so the
  first upgraded launch still reads `openclaw-lark` from the old
  `feishu-openclaw-plugin` mirror. Right after the mirror upgrade, prelaunch
  re-points activation at the installed manifest id (`feishu`), preserving the
  entry settings. A failed upgrade leaves the old manifest and its activation
  in place. The official plugin has 14 Feishu tools instead of openclaw-lark's
  39, without calendar, task, user OAuth, sheet, or search tools. This
  reduction is accepted for the upgrade.

Evidence from a synthetic `/tmp` home on OpenClaw 2026.10.5 under Electron's
Node 24.18.0:

1. A 0.6.1 config and a legacy `@openclaw/qqbot` npm record went through the
   ClawX prelaunch steps (config migration, mirror copy, peer link, and record
   swap).
2. `plugins list` migrated the state database to `user_version` 20, imported the
   `openclaw-qqbot` path record, dropped the legacy table, and reported the
   plugin `loaded`.
3. `config validate` returned `valid: true`. The unmigrated 0.6.1 shape returned
   `allowFrom` and `accounts` errors.
4. A later machine-state write kept the index valid.
5. `gateway run` reached `ready` with `openclaw-qqbot` loaded, and started the
   `default` and `agent-b` accounts against Tencent's API.

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

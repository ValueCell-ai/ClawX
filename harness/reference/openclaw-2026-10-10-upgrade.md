# OpenClaw 2026.10.10 in-place upgrade

Related [task](../specs/tasks/upgrade-openclaw-2026-10-10.md) and
[communication scenario](../specs/scenarios/gateway-backend-communication.md).

## Baselines and dependencies

Treat official ClawX 0.6.1 (OpenClaw 2026.7.1-2) and starting main
`6be7ae2c` (OpenClaw 2026.10.5) as separate inputs. The app version alone
does not identify a database schema or migration receipt.

| Component | Target | Reason |
| --- | --- | --- |
| OpenClaw, official Discord/Feishu/WhatsApp | 2026.10.10 | Matching runtime release |
| WeCom | 2026.10.30 | Uses config.current()/mutateConfigFile(); older loadConfig()/writeConfigFile() are removed |
| DingTalk official connector | 0.8.26 | Current SDK contracts supported; retain main's channel/default-account remapping and dws provisioning |
| Tencent Weixin | 2.4.10 | Supports current SDK and legacy QR account files |
| Tencent QQBot / connector | 2.0.3 / 1.2.0 | Retain main's Tencent account and plugin-identity migration |
| Electron / Windows Node | 41.10.7 / 24.18.1 | Meet Node >=24.16.0 <25 or >=26.1.0 |
| ClawX CUA SDK / CLI | 0.37.0 | Retain the app's direct dependency and downloaded native artifacts, independently of OpenClaw's transitive copy |

Feishu deliberately retains the starting-main migration, including its
[documented tool compatibility boundaries](openclaw-2026-10-5-upgrade.md).
WhatsApp's official dependency is upgraded; its ClawX QR flow is unchanged.
DingTalk 0.8.27 adds unrelated interaction features; this upgrade does not
require adopting those features. Recheck published compatibility before a
future version change.

## Persistence and failure recovery

Snapshot `backups/clawx-openclaw-2026.10.10-pre-migration` is created before
extensions, config synchronization or provider-auth writes. It never reuses
the earlier 10.5 snapshot. SQLite online backups include committed WAL pages
and undergo integrity checks. The manifest records file hashes, original file
modes, directory/link inventories, original paths and absent migration roots.
Snapshots retain channel login files, plugin payloads, history and configured
external Agent/session stores. Ordinary workspaces, skills, browser profiles,
host node_modules and runtime binaries remain outside this migration backup.

Snapshot creation fails closed; incomplete baselines must not be overwritten
with post-migration state. Readiness never removes a baseline. Current Agent
auth schema is 27; the narrowly verified historical v25 marker repair still
targets 25. OpenClaw Doctor owns full migrations, including shared auth state.

Quit **all** ClawX, Gateway and Doctor processes before restoring:

```sh
node <app-resources>/cli/restore-openclaw-upgrade.mjs <snapshot-directory> --confirm-stopped
```

Use a compatible Node runtime. The helper verifies hashes and original paths,
parses the current configuration as JSON5, checks its port plus the original
snapshot/default Gateway ports, and journals before publishing
roots. It retains displaced newer files instead of overlaying old rows on a
new database. External stores stage on their own volume. A failed restore
undoes published roots; the next invocation also undoes an unfinished journal
before retrying. Keep the snapshot and its recovery directories until the
chosen version has been verified. They contain secrets. Port checks complement
the explicit stopped-process requirement; they do not prove no offline Doctor
is running.

The current config is reread before publication. If it is missing, unreadable,
malformed, or contains an invalid Gateway port, recovery stops instead of using
only the old port. Keep the helper with its sibling `openclaw` resource directory,
which supplies the pinned JSON5 parser. A copied helper without that dependency
also refuses recovery.

If interruption occurred after the current config was moved but before its
replacement was published, the missing config blocks automatic journal undo.
Stop every ClawX, Gateway and Doctor process, preserve the journal and displaced
files, then copy the matching config operation's `previous` file back to its
`source` path without removing `previous`. Use the displaced current config,
including its latest port, rather than substituting the snapshot's older config.
After verifying that the current config is readable and valid, retry; the journal
can then undo the interrupted publication. For a malformed config, retain a copy
and repair it with the actual current port before retrying. Never delete or replace
the current config merely to bypass a failed offline check.

After restoring, reinstall the **matching old application** before launching.
Running the new app against restored data triggers migration again. Workspace
edits made after upgrade are outside the rollback and remain in place.

Plugin replacement validates the actual package and manifest identity in
staging. The previous payload is retained until the installation-index
transaction commits. Metadata failure rolls back the payload; retired IDs and
their replacement change in the same SQLite transaction. A retained staging
directory after a process interruption remains an additional recovery input;
the versioned snapshot is the complete pre-upgrade baseline.
Automatic prelaunch upgrades use the same transaction as channel installation.
The maintenance cache is published only after that asynchronous transaction
succeeds, includes the runtime/package identity, and cannot conceal a failed
upgrade. A failed configured-plugin maintenance step stops startup for retry.
Disabled channel configurations retain their plugin payload and index without
enabling accounts; Feishu keeps its starting-main maintenance policy.

## Windows

The installer includes the offline helper at `resources/cli/restore-openclaw-upgrade.mjs`.
Use the bundled Node executable; no system Node installation is required:

```powershell
$resources = 'C:\path\to\ClawX\resources'
& "$resources\bin\node.exe" "$resources\cli\restore-openclaw-upgrade.mjs" "$env:USERPROFILE\.openclaw\backups\clawx-openclaw-2026.10.10-pre-migration" --confirm-stopped
```

Set the real installation and snapshot paths first. Exit ClawX from the tray,
and stop every Gateway/Doctor before recovery. Do not delete SQLite WAL files
to work around a sharing violation. A locked file must leave the newer roots
recoverable; release the owning process, then retry. Restore stages external
Agent stores beside their original path so a different drive does not cause
cross-volume rename failures. Auth-directory junctions retain their targets,
and physical path comparison prevents duplicate captures through aliases.
The Windows snapshot directory inherits the user's directory ACL; POSIX mode
assertions apply only on Unix.

Windows CI retains the starting-main steps. The additional Windows-specific
upgrade tests and CI steps were removed at the user's request on 2026-11-09.
Platform-independent migration and rollback regressions remain, and the bundle
still probes proc-safe from the flattened output. The Electron matrix verifies
both a refused Gateway exit and a successful Doctor exit in real utility
processes. NSIS install-over, updater restart, standard-user ACLs, antivirus
interference and Windows channel delivery still require a Windows installation
acceptance run; macOS tests are not evidence that those Windows-specific
interactions passed.

## Runtime patch maintenance

The 10.10 patch is regenerated against its published ESM files. Compaction
hooks now live in `sdk-*`, process ownership uses proc-safe, and async session
sharing replaces the removed synchronous resolver. ACP transcript-tail import
runs in the event-ledger worker transaction with a sequence check and bounded
retry so concurrent processes cannot duplicate imported events. Native ACP
preamble handling remains intact. Explicit session model choices equal to the
Agent default remain pinned instead of becoming a follow-default choice.

Runtime tests start the supported `openclaw.mjs acp` entry, which prepares the
asynchronous runtime configuration before entering the ACP server. Directly
executing its private server chunk bypasses that initialization in 10.10.
The bundler checks proc-safe's native process-identity read from the flattened
output, and after-pack retains only the target native architecture.
10.10 awaits CLI cleanup and sets `process.exitCode`; Electron utility processes
remain alive even when Node has no active resources. The ClawX bootstrap drains
stdout/stderr and explicitly exits only after the CLI entry resolves with an
exit code. This lets Main receive migration refusal and start its bounded
Doctor/retry flow on Windows as well as macOS. The starting-main Agent v25
refusal has no `gateway.maintenance_required` suffix in 10.10; its explicit
session-identity migration diagnostic also enters that bounded Doctor flow.

## Enterprise integration

SkillsHub 0.1.7 loads against the actual 2026.10.10 SDK and registers its five
declared tools. The sibling ClawX-biz typecheck and existing plugin contract
tests pass, and an isolated enterprise assembly accepts these community
installer changes. No SkillsHub plugin source adaptation is required by those
contracts. Release CI must select the upgraded ClawX commit: a development
CLAWX_ROOT override does not update the enterprise gitlink.

The enterprise browser skill overlay has separate upstream drift (new text,
batch/code-mode guidance and evaluate timeout behavior). Reconcile that overlay
in ClawX-biz while retaining managed-browser ownership, headed-first operation,
user-profile/CDP constraints and handoff rules. It is not a SkillsHub SDK issue.

## Validation boundaries

Automated contracts cover WAL-inclusive backup, corrupted/incomplete inputs,
payload/metadata failures, process-interrupted restore, external Agent stores,
actual channel SDK registration/account resolution, Weixin legacy token reads,
WeCom mutation against a fresh config, ACP replay/restart/compaction and Agent
creation/workspace preservation in Electron. Live account probes are opt-in,
use private isolated state and must not send messages without an explicit test
conversation. Do not equate successful registration or authentication with
verified delivery. Platform installers and real channel delivery require their
own recorded evidence.

## Recorded validation (2026-11-07)

| Input / check | Observed result |
| --- | --- |
| Official 0.6.1 application and 2026.7.1-2 runtime | Seeded history on the old runtime; upgraded directly to 10.10; restarted successfully; retained credentials, account disabled flags, Weixin token fixture and workspace marker; local model reply passed |
| Starting main `6be7ae2c` and 2026.10.5 runtime | Independently seeded history, upgraded and restarted with the same retention assertions and local model reply |
| Offline rollback, both baselines | Restored the pre-migration snapshot after a failed upgrade attempt; the corresponding old application/runtime reopened retained history and answered through the local model; the subsequent upgrade passed |
| Disabled channels | QQ, DingTalk, WeCom and Weixin remained disabled while retaining compatible plugin payloads, credentials and history |
| Fresh profile | Gateway became ready, all four plugins registered at the expected versions, and a local model reply passed |
| Selected live accounts, both migrated profiles | QQ bot3 reached READY, DingTalk bot3 connected, and WeCom bot2 authenticated; connections were then closed; no channel messages were sent |
| Runtime and app regressions | Focused migration, recovery, plugin transaction, ACP and packaging tests passed; Electron E2E passed; typecheck, lint, frontend/runtime/plugin builds, harness validation/CI and comms replay/compare passed |

The macOS x64 application harness used the official 0.6.1 `app.asar` and bundled
runtime from the published, checksum-verified archive. Starting-main source was
compiled from the exact commit above with its 10.5 runtime and plugin bundle.
Both were hosted by Electron 41.10.7, with isolated Electron/OpenClaw directories
and a local synthetic model service. This exercises the application startup,
Doctor, Gateway and plugin migration paths, but does **not** reproduce the
original Electron 40 executable or an operating-system installer replacement.
Weixin login retention used a synthetic account file; no live Weixin account,
Feishu connection, WhatsApp QR login or channel message delivery was tested.

A broad concurrent test run initially timed out in nine runtime tests while
builds and the live application harness shared the host. Those affected tests
passed when rerun with two workers. Lint has seven existing React warnings and
no errors. No native Windows validation was executed on this macOS host. The
additional Windows-specific tests and CI steps from this validation session
were subsequently removed on 2026-11-09. Existing Windows CI and NSIS/updater
installation acceptance remain unverified.
Private account fixtures and copied credentials are removed after validation;
only sanitized result records and logs are retained outside the repository.

## Native Windows follow-up, 2026-11-09

The two Windows package upgrade routes and the reported temporary SQLite
snapshot cleanup failure are tracked separately in
[Windows SQLite upgrade validation](windows-sqlite-upgrade-validation-20261109.md).
That record identifies the packages exercised, retained data checks and channel
connection coverage, and distinguishes those observations from the earlier
macOS validation.

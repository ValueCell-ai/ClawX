# Computer Use

Computer Use is opt-in, default off. `computerUseEnabled` belongs to the Main
settings store; both the typed management API and generic settings mutations
delegate to the same serialized lifecycle service. Reset disables before clearing
settings. Existing installations without the preference remain disabled. Enable
Developer Mode in Settings to reveal the sidebar management page; this UI gate
does not itself enable the service or grant OS permissions.

Startup reconciles the stored choice before automatic Gateway startup. Activation
checks permissions only for enabled instances. Permission status uses Electron's
silent Accessibility check and screen media-access status, never the CUA request
function. Only the management page's explicit enabled permission action invokes
the native CUA permission request. OS grants survive disabling the feature.

Orderly quit starts Gateway and Computer Use cleanup concurrently and logs each
stop failure independently. Both share the existing five-second quit deadline;
the Gateway timeout termination and emergency exit paths are unchanged. E2E mode
still skips Computer Use cleanup. This does not guarantee daemon shutdown before
the deadline or change the service's serialized lifecycle queue.

Disabling stops the daemon and removes the generation descriptor. Lifecycle and
preference mutations remain serialized, not model actions globally. Failures are
surfaced; failed opt-in rolls back to off. Missing permissions or binaries instead
preserve the enabled preference with an unavailable runtime so users can grant
permissions. Computer Use no longer installs, registers, or reconciles a Gateway
plugin or its policy. Unrelated plugin configuration and shell approvals remain
unchanged.

## Native CLI Contract

Electron Main retains the pinned `@trycua/cua-driver` 0.25.0 SDK and
`EmbeddedCuaDriverHost`. Main is the direct parent of the bundled
`cua-driver serve --embedded` daemon and owns its permission policy, exit
monitoring, shutdown, and parent-liveness behavior. Supported hosts remain macOS
13+ Intel/Apple silicon and Windows 10+ x64; upstream Linux or Windows ARM64
documentation does not expand ClawX support. Binaries remain version-pinned,
SHA256-verified, outside ASAR, and signed with the enclosing macOS app.

SDK, native driver, and official Skill are aligned to 0.25.0, from tag
`cua-driver-rs-v0.25.0`, commit `45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f`.
The current upgrade contract is `harness/specs/tasks/cua-025-upgrade.md`.

On macOS and Windows, Main passes `CUA_DRIVER_RS_TELEMETRY_ENABLED=false` in
`EmbeddedDriverHostOptions.environment`; Gateway supplies the same override to
its CLI children. The native SDK safe allowlist admits telemetry variables since
0.22.0 and still does in 0.25.0. Explicit overrides survive `env_clear()` and
`safe_environment`, without mutating Main's parent environment, persistent CUA
settings, or ClawX's telemetry preference. Validate actual manager-produced
options with the real native constructor separately from mocked daemon I/O;
construction must not start a daemon or request OS grants.

Keep the Windows executable's console-to-GUI PE subsystem patch after archive
checksum verification. The 0.25.0 telemetry source still spawns `cmd /c ver`
without a no-window flag; the SDK allowlist change is not an automatic upstream
no-window fix. Telemetry suppression and the PE patch address different process
paths. The 0.21.0 Configuration failure and CLI-only workaround are superseded,
not erased; see `harness/reference/computer-use-cli-validation.md` for their
evidence and pending rebuilt-Windows 0.25.0 acceptance.

`CLAWX_CUA_CONNECTION_FILE` is the stable discovery path under ClawX user data.
Main atomically publishes an owner-private descriptor with exactly this shape:

```ts
{ v: 2, generation, driverVersion, binaryPath, socketPath }
```

The absolute bundled `binaryPath` comes from ClawX's binary resolver; `socketPath`,
`generation`, and `driverVersion` come from the live SDK connection. There are no
MCP launch arguments or dual-format readers. Disable, daemon exit, or replacement
invalidates that generation. The Skill reads the live descriptor at task start and
again after restart/unavailability, not as an extra model round trip before every
action. Existing OpenClaw `exec` invokes its absolute binary with explicit
`--socket PATH`; do not use a PATH-selected system driver, launch a fallback
daemon, or duplicate Main's host permission flags in model commands. Existing
bundled-bin PATH injection is retained but is not the invocation authority.

No ClawX `computer` tool, OpenClaw plugin, MCP proxy, or action wrapper is used.
The full pinned native CLI surface is available subject to platform, application,
and permission constraints: windows, accessibility (AX) trees and element tokens,
menus, browser/recording operations, and bounded `verify_state`, as well as the
existing primary-display screenshot and input capabilities. Prefer native window,
element, and menu operations, using bounded/filtered observations. This is not a
primary-display-only ClawX action subset and does not promise every command works
on every target or preserves foreground focus.

Pinned 0.25.0 `cli.rs::run_call` routes explicit non-default named sessions through
the daemon-scoped `cli-explicit` namespace and skips disposable cleanup for them;
anonymous calls use per-process sessions with `session_end`. This source-level
contract differs from the official Skill's broad disposable-CLI wording and is
not new live 0.25.0 continuity evidence. Repeat a unique workflow label on every
accepting call and use `end_session` for cleanup,
not daemon shutdown. Discard old observations and element tokens after generation
changes. Interpret actual action, effect, and verification results: nested tool
errors and some screenshot-write failures can exit zero. Neither an input
acknowledgment nor shell `&&` proves semantic success. Do not blindly replay input
when completion is unknown.

The `computer-use` Skill keeps `/computer-use` in the existing picker and is based
on the official CUA 0.25.0 accompanying Skill, fixed at tag
`cua-driver-rs-v0.25.0`, commit `45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f`.
MIT-licensed upstream documents and the repository-root license ship offline,
with a short ClawX integration entrypoint. Selecting it never enables the service
or grants permissions. See `harness/reference/computer-use-skill.md` for provenance
and the explicit host-specific overrides.

ClawX owns the entire `~/.openclaw/skills/computer-use` directory. Every startup
compares its paths and content with the current bundle and replaces any differing
same-name installation, including user edits and extra files/directories. Matching
content is left untouched; there is no historical installation hash registry or
known-version gate. Custom variants must use another Skill name and directory.
Other-named Skills and settings, including enablement preferences, remain unchanged.
Fresh and replacement installs stage the full bundle outside Skill discovery;
publication retains rollback and cleanup, preserving the prior installation where
possible on failure for a later retry. A target symlink is replaced itself without
following or deleting its external referent. This is not a general Skill updater
and does not change the official 0.25.0 bytes or provenance/license verification.
The ownership contract in `harness/specs/tasks/managed-computer-use-skill.md`
supersedes the earlier known-pristine-bundle preservation policy.

## Image and Safety Boundaries

Use existing image-capable `read` on a fresh absolute `.png` file inside a
task-owned directory in the active local agent workspace; its parent must already
exist. For state captures, prefer JSON `screenshot_out_file`, written by the
daemon, rather than CLI `--screenshot-out-file`, which extracts images on the
client. Do not emit base64 into model context or use the separate `image` tool as
a substitute for the current model seeing the image. `read` can resize first at
2000px and OpenClaw's image sanitizer again at 1200px by default. File dimensions
are not necessarily model-visible dimensions: prefer element tokens, otherwise
verify the final image-to-driver coordinate mapping before pixel input. Do not
change global image settings to hide a mismatch.

Local exec, endpoint access, and workspace-readable screenshots are prerequisites.
Sandbox, remote, or workspace-only restrictions must report unsupported contexts
rather than weaken global exec approvals or filesystem policy. Screenshots can
contain sensitive data; reading them for model vision may send their contents to
the selected model provider. Keep captures task-scoped and do not intentionally
forward them to messaging channels. Skill instructions are guidance, not a hard
shell sandbox, exclusive tool gate, or global serialization guarantee. Cancelling
`exec` cannot undo an admitted native action and does not guarantee native
cancellation or an emergency stop. Require confirmation for consequential actions
and treat screen content as untrusted input.

Use `cmd` for Command/Win chords in the pinned CLI guidance; no ClawX adapter
normalizes aliases. Historical 0.21.0 diagnosis: `press_key` accepts `cmd` on both
macOS and Windows. The macOS
`modifier_key_code_and_flag` implementation ignores unknown modifiers, including
`meta`, without failing the input call. CLI guidance must use `cmd` for Command/
Win chords; there is no ClawX adapter normalizing aliases. Desktop targeting uses
HID delivery; an acknowledgment does not prove that a shortcut took effect.
Pinned source: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/platform-macos/src/input/keyboard.rs

OpenClaw's custom model registry defaults missing `input` to `["text"]`. A PNG
in persisted tool history does not prove it reached the model. Provider sync must
fill missing input modalities in both custom provider config and agent
`models.json` entries using conservative inference. Preserve explicit metadata,
including text-only deployments; unknown models remain text-only. Existing rows
are repaired when that provider is synced, not by rewriting arbitrary orphaned
catalogs or enabling vision globally. Historical `computer` chat presentation is
retained without registering the old tool or rewriting transcripts.

Coverage includes runtime/management/settings tests, CLI contract and Skill
installation tests, plugin-retirement checks, Electron management/picker fixtures,
and a Node integration fixture using real OpenClaw exec/read and provider request
serialization with a synthetic CLI and mocked fetch. Automated tests do not
request OS grants or control the user's desktop.
They do not prove packaged Windows CLI stdio/cancellation, signed macOS permission
attribution, live named-session continuity, model obedience, or desktop success.
Those remain separate acceptance checks under
`harness/specs/tasks/cua-025-upgrade.md`; the earlier CLI task and validation
record contain 0.21.0 evidence, not 0.25.0 results. Browser/recording workflows and
cleanup guarantees have not been established by these synthetic fixtures.
Native checks need explicit task authorization and grants for the current host
identity; a denied development-host grant is a blocker, not a reason to start a
differently permissioned daemon. Fewer model decisions and redundant captures are
the performance hypothesis, not a claim that CLI transport is inherently faster.

See `harness/reference/computer-use-cli-validation.md` for the actual development
host checks and their limitations; they are separate from automated fixtures.

## Superseded Adapter History

The earlier internal implementation registered `computer` through
`clawx-cua-computer` and an MCP stdio proxy, enforced a primary-display action
subset, and versioned plugin mirrors. Its per-transport session lease rules and
automatic action screenshots are historical, not native CLI requirements. The
`cua-driver-cli` task replaces those requirements without a general production
migration framework. Targeted development cleanup of the known mirror, install
records, and old descriptor must preserve unrelated config. In particular, never
turn a sole-CUA restrictive `plugins.allow` into an absent/empty unrestricted
policy silently; require explicit policy reset for that fixture.

## Permission requests and development attribution

### Packaged native imports

Historical 0.21.0 reproduction (superseded version, retained evidence): that SDK
uses `dist/native/node-runtime.js` and generated `*-ffi.js` loaders.
`@ubjs/node`'s `resolveLibPath` uses `createRequire(callerUrl).resolve` to locate
the sibling platform package. It does not use `import.meta.resolve`, and this
SDK call supplies no library override or environment override. Electron's
virtual filesystem can find an unpacked file via an `app.asar` path while the
native addon's own `dlopen` cannot: macOS returns ENOTDIR (`errno=20`). Electron's
`process.dlopen` handling for `.node` files does not rewrite paths passed later
to Rust's library loader. Unpacking all of `@trycua` alone is insufficient.

`electron/utils/cua-sdk.ts` lazily imports the pinned exported `dist/electron.js`
and `dist/embedded.js` using physical `app.asar.unpacked` file URLs. Unpack
`@ubjs/core` and `@ubjs/node` too; physical ESM imports cannot find JS dependencies
that exist only inside the adjacent archive. Development keeps bare package
imports. There are no dependency patches, signing changes, or TCC workarounds.
This physical-path requirement remains active for 0.25.0. Its export map,
library layout, and rebuilt-package initialization require upgraded-byte checks;
the 0.21.0 results below do not validate the new package.

Run `pnpm cua:smoke:asar <app Resources directory>` to build a minimal true ASAR
app from the packaged SDK bytes and current unpack rules, using a temporary copy
of the pinned Electron runtime. `--baseline` uses bare imports and intentionally
fails with the old virtual-path error. `--artifact` uses the source app's actual
unpacked dependency tree read-only, so stale/missing unpacked JS fails rather than
being repaired by the fixture. Run this after directory packaging as well.
The smoke checks the pinned export map, lazy loading, `app.isPackaged`, fresh
Electron Main processes for each entrypoint, and the physically loaded dylib/DLL
in the process report. It does not use `ELECTRON_RUN_AS_NODE`. `electron` initializes
native bindings on import; `embedded` defers loading, so the smoke invokes only
the generated ABI initializer (checksums/callback registration), never a host
constructor, permission request, settings opener, or desktop action.

The macOS arm64 reproduction used the installed app's unmodified SDK bytes;
its dylib existed and `codesign --verify --deep --strict` succeeded. Both old
load paths failed with errno 20 and both physical load paths passed. This proves
path resolution, not signed-release TCC attribution or Windows execution; run the
same smoke on Windows and Intel macOS artifacts on their respective hosts.
Electron reference: https://www.electronjs.org/docs/latest/tutorial/asar-archives

Historical 0.21.0 reproduction and verification commands (run from the repo root):

```sh
# Expected failure: both generated native loaders receive virtual ASAR paths.
pnpm cua:smoke:asar /Applications/ClawX.app/Contents/Resources --baseline
# Expected failure on the old app: physical imports cannot resolve @ubjs/node.
pnpm cua:smoke:asar /Applications/ClawX.app/Contents/Resources --artifact
# Pass: same packaged SDK bytes with the corrected loader and unpack rules.
pnpm cua:smoke:asar /Applications/ClawX.app/Contents/Resources
pnpm run build:vite
node scripts/run-electron-builder.mjs --mac --arm64 --dir --publish never -c.directories.output=release/cua-asar-fix
pnpm cua:smoke:asar release/cua-asar-fix/mac-arm64/ClawX.app/Contents/Resources --artifact
codesign --verify --deep --strict release/cua-asar-fix/mac-arm64/ClawX.app
```

The historical 0.21.0 arm64 directory build and both artifact imports passed. The normal
builder selected ad-hoc signing and skipped notarization because distribution
credentials were unavailable; no signing settings were overridden to fix loading.
Existing release DMG/ZIP files were not rebuilt or replaced. The smoke tests the
production helper compiled into a minimal package, not full ClawX startup under
a distribution signature. The management E2E additionally verifies the real Main
process has no loaded CUA native libraries after a disabled permission request.
README.md, README.zh-CN.md, and README.ja-JP.md were reviewed: this changes only
internal packaging/loading, not their documented opt-in or permission flow.

### OS attribution

The historical CUA 0.21.0 source inspection found that its Electron helper invokes
the native host request function; screen permission uses
`CGRequestScreenCaptureAccess()` and the read-only probe
uses `CGPreflightScreenCaptureAccess()`. These are not APIs for resetting a
previous decision. A returned request does not prove that a dialog appeared.
Electron's screen status delegates to Chromium's boolean screen-access check,
which maps false to `denied`, unlike camera/microphone authorization enums.
Do not present this as proof the user previously denied a request.

TCC attribution follows the responsible launch chain. The CUA host bundle ID
is advisory and does not force attribution to ClawX. Signed, normally launched
ClawX should own its entry; development launches can be attributed to a terminal
or IDE. A user reported that removing their Ghostty/VS Code recording entry
manually allowed another confirmation. This is a local observation, not a
universal required reset or a promise of re-prompting. The app must never delete
entries, reset TCC, or bypass authorization to reproduce it. Guide users to the
actual listed app and let them manage grants, then restart and refresh.

Historical permission sources (not 0.25.0 native validation):

- https://github.com/trycua/cua/blob/cua-driver-rs-v0.21.0/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md
- https://github.com/trycua/cua/blob/cua-driver-rs-v0.21.0/libs/cua-driver/rust/crates/platform-macos/src/permissions/status.rs
- https://www.electronjs.org/docs/latest/api/system-preferences
- https://github.com/chromium/chromium/blob/main/chrome/browser/permissions/system/system_media_capture_permissions_mac.mm
- https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess()
- https://support.apple.com/guide/mac-help/control-access-to-screen-and-system-audio-recording-mchld6aa7d23/mac

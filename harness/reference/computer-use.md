# Computer Use

Computer Use is opt-in, default off. `computerUseEnabled` belongs to the Main
settings store; both the typed management API and generic settings mutations
delegate to the same serialized lifecycle service. Reset disables before clearing
settings. Existing installations without the preference remain disabled even if
their OpenClaw config previously enabled the plugin.

Startup reconciles the stored choice before automatic Gateway startup. Activation
checks permissions only for enabled instances. Permission status uses Electron's
silent Accessibility check and screen media-access status, never the CUA request
function. Only the management page's explicit enabled permission action invokes
the native CUA permission request. OS grants survive disabling the feature.

Disabling stops the daemon and removes the generation descriptor before updating
plugin policy through the config coordinator. In-flight actions are not replayed.
The coordinator delivers live changes with config.get/config.set, or writes the
file when Gateway is stopped. Gateway owns applying/reloading the plugin config.
OpenClaw treats absent and empty `plugins.allow` as unrestricted. The CUA policy
leaves both unchanged on enable and appends CUA only to an existing nonempty
allowlist. Disable retains the allowlist, even when CUA is its sole entry, and
sets `plugins.entries.clawx-cua-computer.enabled` to false. This avoids granting
unrelated global extensions on disable or blocking providers/tools on live enable.
Startup's separate required-plugin reconciliation is not invoked by live toggles.
Failures are surfaced; the preference remains off on a failed disable, and a
failed opt-in rolls back to off. Missing permissions or binaries instead preserve
the enabled preference with an unavailable runtime so users can grant permissions.

The `clawx-cua-computer` OpenClaw plugin registers `computer` as a model-facing
tool. Its private MCP stdio proxy connects to the Main-owned bundled daemon.
Tool descriptions and the action schema define supported operations and coordinates.
The separate first-party `computer-use` skill supplies screenshot/action/verification
guidance through the existing picker; it does not replace permission or plugin policy.
See `harness/reference/computer-use-skill.md` for its sources and distribution.

Coverage: runtime and management unit tests, plugin policy sanitization tests,
settings persistence tests, and Electron management-page tests. Automated tests
mock native permission requests and do not control the user's desktop.

## Key and image compatibility

CUA 0.21.0 `press_key` accepts `cmd` on both macOS and Windows. The macOS
`modifier_key_code_and_flag` implementation ignores unknown modifiers, including
`meta`, without failing the input call. Normalize model-facing Meta/Cmd/Command/
Win/Super aliases to `cmd`. Desktop targeting uses HID delivery; a successful
acknowledgment remains unverifiable and does not prove Spotlight opened.
Pinned source: https://github.com/trycua/cua/blob/cua-driver-rs-v0.21.0/libs/cua-driver/rust/crates/platform-macos/src/input/keyboard.rs

OpenClaw's custom model registry defaults missing `input` to `["text"]`. A PNG
in a persisted computer tool result does not prove it reached the model.
Provider sync must fill missing input modalities in both custom provider config
and agent `models.json` entries using the existing conservative model inference.
Preserve explicit input metadata (including text-only deployments); unknown
models remain text-only. Existing rows are repaired when that provider is synced,
not by rewriting arbitrary orphaned catalogs or enabling vision globally.

Native regression checks require Accessibility and Screen Recording grants for
the current ClawX host identity. A denied development-host grant is a blocker,
not a reason to launch a differently permissioned daemon or bypass the gate.

CUA 0.21.0 public session labels are transport-owned, including after
`end_session`. A new proxy reusing the fixed `clawx-computer-use` label fails
with `session_unavailable`; explicit reconnects and Gateway restarts against the
same daemon can encounter this. Allocate a UUID-suffixed label per proxy, reuse
it within that transport, and end that same lease at cleanup. Do not replay an
input when its original completion is unknown. Live lifecycle probes reproduced
same-label rejection and fresh-label success without desktop input.

The bundled CUA plugin is versioned independently of ClawX. `ensurePluginInstalled`
preserves same-version mirrors, so these fixes ship as 0.1.1 to replace 0.1.0.
Restart Gateway after the mirror update to discard loaded plugin modules.

## Permission requests and development attribution

### Packaged native imports

CUA 0.21.0 uses `dist/native/node-runtime.js` and generated `*-ffi.js` loaders.
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

Reproduction and verification commands (run from the repo root):

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

The fresh arm64 directory build and both artifact imports passed. The normal
builder selected ad-hoc signing and skipped notarization because distribution
credentials were unavailable; no signing settings were overridden to fix loading.
Existing release DMG/ZIP files were not rebuilt or replaced. The smoke tests the
production helper compiled into a minimal package, not full ClawX startup under
a distribution signature. The management E2E additionally verifies the real Main
process has no loaded CUA native libraries after a disabled permission request.
README.md, README.zh-CN.md, and README.ja-JP.md were reviewed: this changes only
internal packaging/loading, not their documented opt-in or permission flow.

### OS attribution

The pinned CUA 0.21.0 Electron helper invokes the native host request function;
screen permission uses `CGRequestScreenCaptureAccess()` and the read-only probe
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

Sources:

- https://github.com/trycua/cua/blob/cua-driver-rs-v0.21.0/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md
- https://github.com/trycua/cua/blob/cua-driver-rs-v0.21.0/libs/cua-driver/rust/crates/platform-macos/src/permissions/status.rs
- https://www.electronjs.org/docs/latest/api/system-preferences
- https://github.com/chromium/chromium/blob/main/chrome/browser/permissions/system/system_media_capture_permissions_mac.mm
- https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess()
- https://support.apple.com/guide/mac-help/control-access-to-screen-and-system-audio-recording-mchld6aa7d23/mac

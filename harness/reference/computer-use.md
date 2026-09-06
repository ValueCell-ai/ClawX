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

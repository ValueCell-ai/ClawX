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
Tool descriptions and the action schema already explain supported operations and
screenshot coordinates. No Skill is installed. Consider a Skill only for a proven
need for higher-level desktop workflows, not to replace permission or plugin policy.

Coverage: runtime and management unit tests, plugin policy sanitization tests,
settings persistence tests, and Electron management-page tests. Automated tests
mock native permission requests and do not control the user's desktop.

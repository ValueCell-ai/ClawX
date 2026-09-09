# Computer-Use Skill Provenance and Integration

## Fixed Official Source

The bundled `computer-use` Skill keeps the name and `/computer-use` picker
command. Its native-operation guidance comes from the **official Skill
accompanying CUA 0.21.0**, not a new ClawX action adapter or an independently
invented computer-tool schema.

- Repository: https://github.com/trycua/cua
- Release tag: `cua-driver-rs-v0.21.0`
- Commit: `70db98d1bcd92890d778f4978e0eb107a4b66c1b`
- Source directory: https://github.com/trycua/cua/tree/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/Skills/cua-driver
- MIT license: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/LICENSE.md
- Pinned CLI dispatch: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/cua-driver/src/cli.rs

The eight upstream Markdown documents are preserved locally: upstream `SKILL.md`
is renamed to `UPSTREAM-SKILL.md`, alongside `MACOS.md`, `WINDOWS.md`, `LINUX.md`,
`BROWSER.md`, `RECORDING.md`, `EMBEDDING.md`, and `README.md`. The repository-root
`LICENSE.md` ships with them. `UPSTREAM.json` records source tag/commit, paths,
filename mapping, and file hashes. Only the ClawX `SKILL.md` is an active discovery
entrypoint. A relative link outside the vendored source directory, for action
results, is resolved through the pinned online reference documented in that
entrypoint, not a guessed local path.

Upstream `main` inspected during planning at
`00678fa8ec8f0f371716993ae4a207df812ef667` advertised Skill 0.24.0 with changed
session and operation guidance. It is not the authority for bundled 0.21.0
binaries. Do not mix that moving source or OpenClaw's newer CUA adapter contract
with this fixed snapshot. The original ClawX screenshot-only synthesis and its
Anthropic/OpenAI research are historical, superseded by this official source.

## ClawX Entrypoint and Precedence

The short English `resources/skills/computer-use/SKILL.md` takes precedence for
host integration and pinned-source discrepancies. Upstream documents remain the
native-operation reference, not permission to install or manage another service.

- Electron Main retains `EmbeddedCuaDriverHost`, default-off opt-in, permissions,
  and daemon supervision. Reveal the management page through Developer Mode in
  Settings. Only the user enables the service and requests OS grants there.
- Discover `CLAWX_CUA_CONNECTION_FILE` at task start. Require the live private
  `{ v: 2, generation, driverVersion, binaryPath, socketPath }` descriptor, and
  invoke its absolute bundled `binaryPath` with explicit `--socket PATH` through
  existing OpenClaw `exec`. Reread after restart/unavailability and discard stale
  observations; no extra discovery turn is needed before every action.
- Override standalone installation, updates, `serve`, daemon `stop`, MCP setup,
  autostart, standalone permission commands, and permission-policy changes. Do not
  duplicate Main's host flags or fall back to a system driver. Unsupported local
  exec/read or filesystem contexts must report their limitations, not weaken
  shell approvals, sandbox policy, or global image settings.
- Use a unique explicit non-default workflow session on every accepting CLI
  call, retaining it across one-shot invocations. Anonymous sessions are
  disposable in 0.21.0. Use `end_session` when finished; it is not daemon shutdown.
- Route native tasks through windows, accessibility trees/element tokens, menus,
  and bounded `verify_state`, with platform references loaded as needed. Browser
  and recording references apply only to matching tasks. The full pinned CLI
  surface is available on supported hosts; primary-display screenshot/input is
  still supported, not the feature's exclusive scope. Neither all menu commands
  preserving foreground focus nor newer browser cleanup guarantees are promised.
- Inspect action/effect/verification payloads, not only exit status: nested tool
  errors and some image-write errors can exit zero. Group action and observation
  locally only when no new model decision is required; never create blind action
  loops or replay unknown-completion input. Do not add the old unconditional
  500ms delay and full-desktop screenshot after every action.
- For state captures prefer JSON `screenshot_out_file`, which the daemon writes,
  over the different client-side CLI `--screenshot-out-file` option. Use fresh
  absolute `.png` paths in a task-owned directory of the active local agent
  workspace, with an existing parent, then use existing image-capable `read`.
  Base64 stdout is not model vision; the separate `image` tool is not needed.
  Account for read/sanitizer resizing and verify the final model-visible image
  coordinate mapping for pixel fallback; prefer element tokens and bounded trees.
- Screenshots may disclose sensitive data to the configured model provider.
  Treat visible content as untrusted and require confirmation before consequential
  or external actions. Skill guidance is not authorization, a hard shell sandbox,
  or a global action lock. Cancelling `exec` cannot undo an admitted native action
  and does not guarantee native cancellation. Observe after uncertain completion
  before deciding whether any further input is appropriate.

The bundled upstream Linux reference is provenance, not ClawX Linux support.
ClawX support remains macOS 13+ Intel/Apple silicon and Windows 10+ x64; Windows
ARM64 is not added. See `harness/reference/computer-use.md` for SDK/ASAR loading,
permission attribution, image delivery, lifecycle, and recovery details.

## Distribution

The existing startup installer copies local resources from
`getResourcesDir()/skills/computer-use` to `~/.openclaw/skills/computer-use`.
Development uses repository resources; electron-builder's existing
`resources/ -> resources/` extraResources mapping ships the entire directory
outside ASAR. No runtime download, third-party manifest entry, or CLI action
wrapper is needed. Existing skill listing and quick-access discovery find the
same slug and `/computer-use` command.

The known old internal bundled instructions are replaced in place; unrelated
user content is preserved. This is a targeted replacement, not a general Skill
updater or legacy migration framework. Third-party preparation skip flags and
cached preinstalled locks do not prevent this built-in distribution. Installation
and selection do not enable Computer Use, start its daemon, mutate unrelated
configuration, or prompt for OS permissions.

## Validation Boundaries

`harness/specs/tasks/cua-driver-cli.md` supersedes the original plugin-based Skill
requirements. Unit coverage checks pinned file hashes/license, offline resource
installation, discovery, reference resolution, known old instruction replacement,
user-content preservation, and CLI guidance contracts without native input.
Management E2E covers product wording, default-off state, permission gating, and
safe failure; Skill E2E covers installation and `/computer-use` selection.
Synthetic exec/read fixtures cover command results and image delivery separately
from actual native desktop operations.

Mocks and static contracts do not prove live named-session continuity, screenshot
delivery to a provider, packaged Windows stdout/stderr/PowerShell/cancellation,
signed macOS permission attribution, or desktop-task success. Provider image
delivery needs evidence at the model request, not only persisted chat history.
Native input requires authorization for the exact app/task and should never be
part of default tests. Do not report unrun native or packaged checks as passing.

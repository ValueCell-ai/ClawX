# Computer-Use Skill Provenance and Integration

## Fixed Official Source

The bundled `computer-use` Skill keeps the name and `/computer-use` picker
command. Its native-operation guidance comes from the **official Skill
accompanying CUA 0.25.0**, not a new ClawX action adapter or an independently
invented computer-tool schema.

- Repository: https://github.com/trycua/cua
- Release tag: `cua-driver-rs-v0.25.0`
- Commit: `45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f`
- Source directory: https://github.com/trycua/cua/tree/45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f/libs/cua-driver/rust/Skills/cua-driver
- MIT license: https://github.com/trycua/cua/blob/45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f/LICENSE.md
- Pinned CLI dispatch: https://github.com/trycua/cua/blob/45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f/libs/cua-driver/rust/crates/cua-driver/src/cli.rs

The eight upstream Markdown documents are preserved locally: upstream `SKILL.md`
is renamed to `UPSTREAM-SKILL.md`, alongside `MACOS.md`, `WINDOWS.md`, `LINUX.md`,
`BROWSER.md`, `RECORDING.md`, `EMBEDDING.md`, and `README.md`. The repository-root
`LICENSE.md` ships with them. `UPSTREAM.json` records source tag/commit, paths,
filename mapping, and file hashes. Only the ClawX `SKILL.md` is an active discovery
entrypoint. A relative link outside the vendored source directory, for action
results, is resolved through the pinned online reference documented in that
entrypoint, not a guessed local path.

Historical, superseded source selection: the previous 0.21.0 bundle used tag
`cua-driver-rs-v0.21.0`, commit `70db98d1bcd92890d778f4978e0eb107a4b66c1b`.
Upstream `main` inspected during that planning at
`00678fa8ec8f0f371716993ae4a207df812ef667` advertised Skill 0.24.0 with changed
session and operation guidance. Neither is the authority for the current 0.25.0
bundle. Do not mix moving source or OpenClaw's separate CUA adapter contract
with the fixed release snapshot. The original ClawX screenshot-only synthesis and its
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
  call. Pinned 0.25.0 `run_call` uses the shared daemon-scoped `cli-explicit`
  namespace for these labels, while anonymous calls are disposable. This is a
  source-level override of the official Skill's broad disposable-CLI statement,
  not proof of live 0.25.0 continuity or permission to add persistent MCP. Labels
  do not grant authority or survive daemon generations. Use `end_session` when
  finished; it is not daemon shutdown.
- Route native tasks through windows, accessibility trees/element tokens, menus,
  and bounded `verify_state`, with platform references loaded as needed. Browser
  and recording references apply only to matching tasks. The full pinned CLI
  surface is available on supported hosts; primary-display screenshot/input is
  still supported, not the feature's exclusive scope. Neither all menu commands
  preserving foreground focus nor newer browser cleanup guarantees are promised.
  The 0.25.0 upstream browser preparation, session-scoped refs, and cleanup
  guidance is not evidence of a working ClawX browser workflow. Observe exact
  targets, require authorization for foreground takeover, and stop on unavailable
  routes rather than assuming the upgrade repaired them.
- Inspect action/effect/verification payloads, not only exit status: nested tool
  errors and some image-write errors can exit zero. Group action and observation
  locally only when no new model decision is required; never create blind action
  loops or replay unknown-completion input. Do not add the old unconditional
  500ms delay and full-desktop screenshot after every action.
- For state captures prefer JSON `screenshot_out_file`, which the daemon writes,
  over the different client-side CLI `--screenshot-out-file` option. Pinned
  `run_call` still decodes response image blocks for the latter and may only log
  write failures; the upstream Skill's "equivalent" wording does not establish
  identical failure behavior. Use `get_window_state` or `get_desktop_state`, not
  the removed standalone `screenshot` tool or retired `capture_scope` settings.
  Select the exact window or desktop target per action. Use fresh
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

ClawX owns the entire installed `computer-use` directory. On every startup,
compare the current source and destination dynamically, including relative paths
and file contents. Any difference, including local edits, missing files, extra
files/directories, or an unknown same-name Skill, triggers full replacement with
the current bundle. Matching content is left untouched. There is no historical
installation hash registry, old-version detection, or user-content preservation
exception inside this directory. Custom variants must use another Skill name and
directory; other-named Skills and settings, including enablement, are untouched.

Stage the complete bundle outside discovery for both fresh and replacement
installs, then publish it with rollback and cleanup. A failed copy or publication
preserves the previous installation where possible and remains retryable; fresh
installs must not expose a partial copy. Replace a same-name symlink itself without
following or deleting its external referent. This narrowly scoped ownership policy
does not introduce a general Skill updater or legacy migration framework. The
official 0.25.0 document bytes and provenance/license checks, including the source
file hashes in `UPSTREAM.json`, remain unchanged; those hashes verify provenance,
not eligibility to replace an installation.
Third-party preparation skip flags and
cached preinstalled locks do not prevent this built-in distribution. Installation
and selection do not enable Computer Use, start its daemon, mutate unrelated
configuration, or prompt for OS permissions.

## Validation Boundaries

`harness/specs/tasks/cua-025-upgrade.md` remains the version/source contract;
`harness/specs/tasks/managed-computer-use-skill.md` supersedes its known-pristine
installation policy with authoritative same-name replacement.
`harness/specs/tasks/cua-driver-cli.md` superseded the original plugin-based Skill
requirements; its 0.21.0 validation remains historical.
Required unit coverage includes pinned file hashes/license, offline resource
installation, discovery, reference resolution, dynamic whole-directory comparison,
unchanged-content skip, staged fresh/replacement publication, rollback, symlink
safety, unrelated Skill/settings preservation, and CLI guidance without native input.
Management E2E covers product wording, default-off state, permission gating, and
safe failure; the four-locale Skill E2E seeds an edited same-name bundle and extra
file/directory in each isolated test home before launch, asserts every bundled path
and byte is restored and extras removed, and preserves another-named custom Skill.
It also checks `/computer-use` selection without enabling or starting Computer Use.
Synthetic exec/read fixtures cover command results and image delivery separately
from actual native desktop operations.

Mocks and static contracts do not prove live named-session continuity, screenshot
delivery to a provider, packaged Windows stdout/stderr/PowerShell/cancellation,
signed macOS permission attribution, or desktop-task success. Provider image
delivery needs evidence at the model request, not only persisted chat history.
Native input requires authorization for the exact app/task and should never be
part of default tests. Do not report unrun native or packaged checks as passing.

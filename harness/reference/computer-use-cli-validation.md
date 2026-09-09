# Computer Use CLI Validation

## Scope

Validated on 2026-09-09 on macOS arm64, with bundled CUA Driver/SDK 0.21.0 and
OpenClaw 2026.7.1-2. The Skill remains `computer-use` and is based on the official
0.21.0 accompanying Skill, pinned in its `UPSTREAM.json`.

## Automated Results

- `pnpm run lint:check`: passed with seven existing React fast-refresh warnings.
- `pnpm run typecheck`: node and web passed.
- `pnpm test`: 201 files passed; 2366 tests passed, three skipped.
- `pnpm run build:vite`: Renderer, Main and preload builds passed. Existing
  chunk-size, mixed-import and Browserslist warnings remain.
- `pnpm exec playwright test tests/e2e/computer-use.spec.ts tests/e2e/computer-use-skill.spec.ts tests/e2e/developer-mode.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts`:
  40 passed, including configured dependency specs and all four Skill locales.
- `pnpm run harness:ci`: passed.
- `pnpm harness run --spec harness/specs/tasks/cua-driver-cli.md`: passed, including
  fast checks, all unit tests, `comms:replay`, and `comms:compare`.
- Two read-only review rounds: no unresolved Critical or Important findings.

`tests/unit/cua-cli-exec.test.ts` uses real pinned OpenClaw exec/read and its AI
provider adapter. A fake CLI connects to a test-owned socket across separate
processes, writes a synthetic PNG, and preserves semantic error output even when
the process exits zero. The adapter's serialized HTTP body is captured at a mocked
fetch boundary: image-capable read supplies image content; a screenshot path on
stdout does not. This proves neither live provider receipt nor the complete
Gateway/ACP model-driven loop. The synthetic 1x1 PNG does not test resizing.

## Development Host

Started with the user-requested command:

```sh
CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev
```

Connected the Playwright Electron MCP to Renderer on port 9223. The existing
Computer Use preference was enabled and both macOS grants were already present;
no permission request or system grant change was made.

Observed:

- The management page rendered native CLI wording and the official 0.21.0 Skill
  attribution. The existing `/computer-use` picker item remained selectable; no
  chat prompt was sent during picker validation.
- Main published a v2 descriptor with an absolute bundled binary, private socket,
  driverVersion 0.21.0 and UUID generation. It published no MCP launch payload.
- Separate native CLI calls shared one explicit named session. `sessions list`
  showed one active, non-implicit CLI session; `end_session` returned `active:false`.
- `list_windows` identified only the requested ClawX process's windows.
- `get_window_state` wrote a valid 1568x980 PNG for the ClawX window and the image
  was read successfully. No other application's image was captured.
- `verify_state` for that exact window with `window.exists:true` returned
  `satisfied`, one sample, and reported 39ms. This is a single predicate result,
  not a driver throughput benchmark or proof of an input's effect.
- `check_permissions` was read-only and reported the daemon embedded under the
  ClawX host with both grants present. This development observation is not proof
  of signed-release TCC attribution on other machines.
- Disabling through the management page removed the descriptor and stopped the
  service. A call to the old socket failed without starting another service.
  Re-enabling restored the original preference with a new generation/socket.
- Renderer reported zero console errors during these checks.

## Native Input Limitation

CUA 0.21.0 reported `ax_window_unresolved` for the observed Electron window:
there were zero AXWindow matches, so the element tree was empty and background
window-input routes were refused. Window capture and the existence predicate
still worked.

One screenshot-grounded, foreground window click aimed at the harmless Refresh
button returned `effect:unverifiable`, `route:global_input`. A Renderer click
listener recorded zero clicks. The input was not replayed and is not counted as
a successful interaction.

Pinned-source inspection explains why the result is not confirmation: this
unmodified foreground window-click branch uses foreground-assisted PID event
posting, while its result adapter labels it global input. The foreground helper
does not require its AX focus wait to succeed before posting. The supplied nested
window target and screenshot coordinates match the contract; no local coordinate
or CLI-session fix was established. Desktop HID fallback was not exercised.

Sources:
- https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/platform-macos/src/tools/click.rs
- https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/platform-macos/src/input/skylight.rs
- https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/cua-driver-core/src/action_record.rs

## Internal Installation Cleanup

The development machine retained an enabled `clawx-cua-computer` test plugin.
With Gateway stopped, the official OpenClaw uninstall command removed its exact
config entry, installation record, and allowlist entry. The allowlist contained
other entries and remained nonempty. After Gateway restart, it was ready and the
legacy entry was absent and not allowed; the new CLI service remained running.

The uninstaller intentionally retained the path-installed source directory. Its
MCP client differed from the branch snapshot, so those files were not manually
deleted. They are no longer allowed/registered through the old managed entry.
No unrelated plugin configuration was changed. A pre-existing validation warning
for `clawx-openai-image-install-verify` remained outside this change's scope.

## Remaining Acceptance

- Packaged Windows stdout/stderr, PowerShell JSON/Unicode, wait and cancellation.
- Signed-release macOS attribution and Intel macOS native behavior.
- Native AX actions, browser/recording workflows and desktop HID fallback.
- Final model-visible resized-image coordinate mapping.
- Live model-driven completion, stop behavior and a controlled same-model latency
  comparison. No speedup percentage or universal task-success claim is made.

## Windows Telemetry Flash Follow-Up

The user performed an A/B/C/B control in Windows ClawX using the same ordinary
exec path. A pure PowerShell command did not flash. Each normal bundled
`manifest --pretty` call flashed once, before the exit code was printed. The same
calls with `CUA_DRIVER_RS_TELEMETRY_ENABLED=false` did not flash; repeating the
normal calls restored the original symptom. These are user-reported native
results, not observations from this macOS test host.

This isolates the telemetry-enabled path. Pinned 0.21.0 source shows a CLI
completion worker building telemetry payloads with `os_major()`, whose Windows
implementation starts `cmd /c ver` without a no-window creation flag. The PE
patch applies to cua-driver.exe, not this descendant cmd.exe. The precise window
owner has not been captured with a Windows process trace; the observed timing
alone does not establish which worker created it.

ClawX supplies the public telemetry-off override to the Gateway environment
inherited by exec/CLI children on macOS and Windows. It does not override daemon
telemetry, because the pinned embedded SDK rejects that variable (see below).
No upstream binary, persistent CUA setting, system environment or Skill command
is changed. The normal CUA CLI self-reexec is not claimed to disappear; disabling
telemetry prevents its telemetry worker path. Restart ClawX after installing the
updated build, then repeat the normal B test without setting the variable
manually. That rebuilt-Windows acceptance remains pending. Tests cover real
OpenClaw exec environment inheritance into synthetic CLI processes.

Source: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/cua-driver/src/telemetry.rs

## Embedded SDK Configuration Regression

The initial telemetry fix also passed the variable through
`EmbeddedDriverHostOptions.environment`. The user reported daemon startup failure
at `EmbeddedCuaDriverHost.withOptions`, before spawning. A real 0.21.0 native SDK
constructor reproduced the exact error, with `error.inner.reason`:

```text
environment variable CUA_DRIVER_RS_TELEMETRY_ENABLED is not in the embedded safe allowlist
```

The SDK's `validate_options` checks a fixed environment allowlist that excludes
this variable. Its daemon launch also uses `env_clear()` and `safe_environment`,
so placing the variable in Main's `process.env` would not deliver it either.
Restore the accepted empty override list; retain the independent Gateway/CLI fix.
Do not bypass the SDK boundary, change persistent settings, or replace the host
lifecycle to force daemon telemetry off.

The previous mock asserted the requested name/value pair but never ran native
validation, so it falsely accepted the invalid options. The new regression test
passes the actual manager-generated options through the real native constructor
on supported macOS/Windows hosts, destroys the unstarted native host, and mocks
only subsequent daemon I/O. Before the fix it failed with the same Configuration
error as the installed app. Linux skips the native test because ClawX does not
ship its CUA SDK runtime there.

The Windows job in `.github/workflows/check.yml` explicitly runs that constructor
test; the Ubuntu full-unit job alone would skip it. Local validation passed 71
focused tests including the real SDK seam, typecheck, targeted lint, and comms
replay/compare. The installed app's unpacked native SDK also accepted the corrected
options in a constructor-only Node probe, with no daemon or permission request.
The updated Windows CI job and rebuilt-app startup still require their respective
hosts/builds; constructor validation is not a claim of full desktop execution.

Source: https://github.com/trycua/cua/blob/70db98d1bcd92890d778f4978e0eb107a4b66c1b/libs/cua-driver/rust/crates/cua-driver-sdk/src/embedded.rs

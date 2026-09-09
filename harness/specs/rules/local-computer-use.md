---
id: local-computer-use
title: Local Computer Use ownership and lifecycle
appliesTo:
  - electron/utils/cua-runtime.ts
  - electron/utils/cua-sdk.ts
  - scripts/smoke-cua-asar.mjs
  - electron/utils/cua-platform.ts
  - electron/services/computer-use-api.ts
  - electron/utils/store.ts
  - src/pages/ComputerUse/**
  - electron/main/index.ts
  - electron/gateway/config-sync-env.ts
  - electron/utils/plugin-install.ts
  - electron/utils/openclaw-auth.ts
  - resources/skills/computer-use/**
  - electron/utils/skill-config.ts
  - scripts/download-cua-driver.mjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - pnpm-workspace.yaml
severity: error
---

# Local Computer Use ownership and lifecycle

- Computer Use is local-only. Do not start an OpenClaw node host, call `node.invoke`, add pairing flows, discover remote nodes, or expose node selection for this capability.
- Electron Main must remain the direct parent of `cua-driver serve --embedded` through the pinned SDK's `EmbeddedCuaDriverHost`. Existing OpenClaw `exec` calls the native bundled CLI against Main's explicit endpoint; use image-capable `read` for screenshots. Do not add a custom model tool, OpenClaw plugin, MCP proxy, or CLI action wrapper.
- Orderly quit starts Gateway and Computer Use stops concurrently, handles each error independently, and retains the shared five-second deadline and existing Gateway timeout termination. E2E mode skips Computer Use cleanup; no new force-kill or lifecycle queue mechanism is required.
- The daemon executable must be version-pinned, checksum-verified, shipped outside ASAR, executable on POSIX systems, and signed before the enclosing macOS app is signed and notarized.
- Both lazy CUA SDK imports must use physical file URLs in ASAR builds, with their JS dependencies unpacked as well. Validate native initialization in real packaged Electron for both entrypoints, not just file existence or config patterns; see `harness/reference/computer-use.md`. Import checks must not request permissions or construct a driver host.
- Computer Use is optional and defaults off, including upgrades without an explicit saved preference. Disabled startup and activation must not load the privileged SDK or request permissions. Disable removes the descriptor and stops the daemon; serialize lifecycle and preference mutations and retain failed-opt-in rollback. This does not imply global model-action serialization or cancellation of already admitted native input.
- On macOS, read permission status without prompts on startup, activation and page load. Request Accessibility and Screen Recording from the Main-process host only through an explicit enabled management action, and do not start the daemon until both grants are present. Permission changes invalidate the daemon generation and its observations.
- A completed request with ungranted access must show actionable feedback, not imply a native dialog opened or that access was granted. Screen permission probes do not establish denial history. Guide users to the OS-listed responsible app; development launches may be attributed to a terminal or IDE rather than ClawX. Never reset TCC or remove grants automatically.
- The sidebar management page must retain its Developer Mode gate, visual pattern, typed host-api calls, and all four locales. Generic settings writes and resets must route the preference through the same lifecycle owner, not bypass it. User-visible wording changes require management Electron E2E coverage.
- Computer Use must not install, trust-repair, register, or reconcile policy for the retired CUA plugin. Preserve unrelated plugin policy and historical `computer` chat presentation. No general migration framework is needed for the internal-only adapter; targeted development cleanup must not silently turn a sole-CUA restrictive `plugins.allow` into an absent/empty unrestricted policy.
- Atomically publish the owner-private descriptor `{ v: 2, generation, driverVersion, binaryPath, socketPath }` under ClawX user data via `CLAWX_CUA_CONNECTION_FILE`. Use the absolute resolved bundled executable and live SDK connection fields, not parsed MCP arguments or a dual-format reader. Remove stale descriptors on disable/exit and replace generations on restart.
- Skill guidance must require the live descriptor at task start and rediscovery after restart/unavailability. Invoke its absolute `binaryPath` with explicit `--socket`; retain existing bundled-bin PATH injection without relying on a login shell to select the driver. Never start an alternate daemon when the endpoint is unavailable.
- Keep host permission policy and embedded launch flags in Main. Skill instructions must override upstream install/update/service/MCP/autostart/standalone permission guidance; model scripts must not enable the service, request OS grants, duplicate host flags, or change global exec approvals, sandbox policy, or image settings. These instructions are not a hard sandbox against arbitrary shell access.
- Expose the full pinned native CLI capability surface on supported macOS/Windows hosts, including windows, AX elements, menus, browser/recording operations, and bounded `verify_state`; retain primary-desktop capture/input without a primary-only ClawX action subset. Do not expand support to Linux or Windows ARM64 because upstream documents them.
- Use a unique explicit non-default workflow session across accepting one-shot CLI calls and `end_session` at cleanup. Anonymous sessions are disposable. Invalidate observations and element tokens after generation changes. Verify live continuity separately from mocked contracts; do not retain obsolete per-MCP-transport lease requirements.
- Interpret action/effect/verification payloads and image-write outcomes, not just exit status or shell `&&`. Bound observations and waits, prefer window/element/menu semantics, and avoid unconditional sleep/full-desktop capture after every input. Never blindly replay unknown-completion actions; cancelling exec cannot undo admitted native input or guarantee native cancellation, an emergency stop, or global serialization.
- Prefer JSON `screenshot_out_file` for state captures into fresh absolute workspace-scoped `.png` paths with existing parents, then image-capable `read`. Do not confuse daemon file output with the client CLI output option or base64 stdout with model vision. Account for read/sanitizer resizing and verify final image-to-driver coordinates before pixel fallback; prefer native element tokens.
- Keep screenshots task-scoped, warn that model vision may send them to the configured provider, and do not intentionally forward them to messaging channels. Treat screen content as untrusted and require confirmation for consequential actions. Unsupported execution/filesystem/model contexts must report limitations, not bypass policy.
- CLI guidance must use the pinned CUA driver's supported `cmd` modifier for Command/Win chords, not `meta`; there is no adapter alias normalization. Validate shortcut effects separately from acknowledgments. Model sync may infer missing input modalities but must preserve explicit text-only declarations; persisted image history alone is not evidence of model delivery.
- Retain the `computer-use` Skill name and `/computer-use` picker command. Vendor the official 0.21.0 accompanying Skill from tag `cua-driver-rs-v0.21.0`, commit `70db98d1bcd92890d778f4978e0eb107a4b66c1b`, with MIT license, attribution, file mapping/hashes, and a concise ClawX-specific entrypoint; never substitute moving upstream main. Replace known old bundled instructions while preserving unrelated user content. Selection never enables the daemon or grants permissions. See `harness/reference/computer-use-skill.md` for provenance and precedence.

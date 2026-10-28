---
id: openclaw-runtime-child-processes
title: OpenClaw runtime child processes stay in Node mode, hidden, and junction-safe
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Rules:
  - Every ClawX-launched OpenClaw process loads `openclaw-runtime-compat.mjs`. Utility-process launches go through `forkOpenClawUtilityProcess`. `child_process` launches (ACP, completion) preload it with `--import` from `ensureOpenClawRuntimeCompat`. Do not launch `openclaw.mjs` without the shim.
  - Do not run plugin-mutating OpenClaw CLI commands in prelaunch while `openclaw config validate` fails. Defer them without caching the attempt.
  - The shim defaults `windowsHide: true` for every `child_process` spawn, exec, and fork variant, including `promisify.custom`, and keeps an explicit `windowsHide: false`. On Windows, a console child of a console-less parent (the utility process, or a `windowsHide` fork of `node.exe`) otherwise opens a visible console window.
  - On win32, the shim makes recursive `fs.rmSync` unlink every symlink and junction in the tree before removal, because Node 24's native implementation deletes through junctions. Plugin captures junction `node_modules/openclaw` to the bundled runtime. ClawX Main-process code removes trees with `safeRmSync`, never with a recursive `rmSync`.
  - Keep the re-exec handling (`ELECTRON_RUN_AS_NODE=1` and the `--import` preload for `process.execPath`, `fork`, and `Worker`) separate from the window default, which applies to all commands.
Validation:
  - `tests/unit/openclaw-utility-process.test.ts` records the options each original `child_process` call receives behind the shim.
  - `tests/unit/openclaw-utility-process.test.ts` simulates Node 24's Windows `rmSync` and asserts that junction targets survive a capture removal.
  - `tests/unit/openclaw-cli.test.ts` asserts the ACP fork spec preloads the shim.

See `harness/reference/openclaw-2026-10-5-upgrade.md` (Utility-process
bootstrap; Windows: capture cleanup deleted the bundled OpenClaw; Windows:
console windows from runtime re-execs).

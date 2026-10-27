---
id: surface-openclaw-startup-failure-details
title: Fix the Windows koffi bundle break and surface OpenClaw startup failure details
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the packaged Windows in-place upgrade (0.6.1 / OpenClaw 2026.7.1 state → OpenClaw 2026.10.5) start the Gateway by keeping koffi's JavaScript entry in the bundle, report the underlying Gateway and Doctor error chain in ClawX logs and issue reports, and keep the ACP client from touching unmigrated shared state while the Gateway starts or Doctor repairs it.
touchedAreas:
  - README*.md
  - electron/**
  - harness/**
  - scripts/**
  - tests/**
expectedUserBehavior:
  - On Windows the Gateway and Doctor can open the shared state database snapshot again, because the bundled koffi package keeps `src/koffi/index.cjs`; Doctor then migrates the 2026.7.1 state and the Gateway starts.
  - When the Gateway or the startup doctor repair exits during startup, the ClawX log contains OpenClaw's `Reason:` and stack, including every nested `AggregateError` entry and `cause`, instead of only "The CLI command failed." or "Shared-state read and cleanup failed".
  - An exported issue report contains OpenClaw's own runtime log directory (`%TEMP%\openclaw` on Windows, `/tmp/openclaw` or `$TMPDIR/openclaw-<uid>` on POSIX) in addition to `<stateDir>/logs`.
  - Opening Chat before the Gateway is connected no longer starts an `openclaw acp` process; the ACP history load waits for the Gateway and then proceeds.
  - The startup doctor repair stops any running ACP process before it migrates shared state.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/issue-report-api.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
acceptance:
  - '`scripts/bundle-openclaw.mjs` no longer removes `node_modules/koffi/src`, and bundle verification fails when the bundled koffi cannot be required and used by the host Node.'
  - Every OpenClaw utility process launched through `forkOpenClawUtilityProcess` receives `OPENCLAW_DEBUG=1`; the ACP child receives it as well.
  - Under `OPENCLAW_DEBUG=1` the runtime compatibility shim wraps the existing `Error.prepareStackTrace` and appends bounded `errors[n]` and `cause` sections, guarded against cycles and depth, leaving the first stack line unchanged; without the variable the stack formatter is untouched.
  - The ACP service forks its child only after the injected Gateway reports a connection, with a finite wait and a clear error when the Gateway never connects; services without a Gateway client keep the existing behavior.
  - '`runOpenClawDoctorRepair` stops the active ACP service before forking Doctor.'
  - Issue-report export adds the newest OpenClaw runtime log files under `logs/openclaw-runtime/`, redacted like other logs and bounded in size, and reports a missing runtime log directory in the manifest.
  - No user configuration, state database, or agent database is modified by these diagnostics.
docs:
  required: true
---

Follow-up to `fix-openclaw-runtime-descendants`. The 2026-10-27 Windows
reports show the Gateway leaving `cli.bootstrap.admission.state-snapshot`
without entering its callback and Doctor refusing maintenance with
`AggregateError: Shared-state read and cleanup failed`. The OpenClaw runtime
log from the test machine (`%TEMP%\openclaw\openclaw-2026-10-27.log`) names
the cause: `DoctorUnreadableStateDatabaseError ... Cannot find module
'./src/koffi/index.cjs'` from `resources/openclaw/node_modules/koffi/index.cjs`
via `dist/windows-private-directory-*.mjs`. koffi 3.x moved its JavaScript
entry under `src/koffi/`, which the bundle cleanup deleted as C++ sources; the
Windows-only snapshot staging root path is why macOS could not reproduce it.
OpenClaw hides `Reason:` and the stack unless `OPENCLAW_DEBUG` is set, and an
`AggregateError` stack never lists its entries, so this task also makes the
underlying chain observable in ClawX. See
`harness/reference/openclaw-2026-10-5-upgrade.md`.

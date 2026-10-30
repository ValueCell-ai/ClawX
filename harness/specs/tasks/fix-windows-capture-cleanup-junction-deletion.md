---
id: fix-windows-capture-cleanup-junction-deletion
title: Stop OpenClaw capture cleanup from deleting the bundled runtime on Windows
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: After a 0.6.1 in-place upgrade on Windows, the first launch ran capability consent on the unmigrated config. When that command exited, its plugin capture cleanup deleted files under `resources\openclaw` through the `node_modules/openclaw` junction, and every later Gateway and Doctor launch failed with `Cannot find module ...\node-compile-cache.mjs`. Make recursive removal junction-safe in every OpenClaw process and in ClawX Main, and stop running consent on a config that only Doctor can migrate.
touchedAreas:
  - electron/utils/openclaw-utility-process.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/openclaw-command.ts
  - electron/utils/plugin-capability-consent.ts
  - electron/gateway/skills-symlink-cleanup.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-command-validate.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/skills-symlink-cleanup.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/openclaw-runtime-child-processes.md
  - harness/specs/tasks/fix-windows-capture-cleanup-junction-deletion.md
expectedUserBehavior:
  - A 0.6.1 → 2026.10.5 in-place upgrade on Windows keeps the installed OpenClaw runtime intact, and the Gateway starts after the automatic Doctor repair.
  - The first upgraded launch does not spend minutes on capability consent before Doctor runs. Consent is recorded on a later launch once the config is valid.
  - Skill and runtime-cache link cleanup removes only the links, never the linked skills or runtimes.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-command-validate.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/skills-symlink-cleanup.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/acp-chat-service.test.ts
acceptance:
  - On win32, the runtime compatibility shim's `fs.rmSync` with `recursive` unlinks a root link and every nested symlink or junction before calling the original, and is reachable through default and named ESM imports.
  - With simulated Node 24 Windows removal semantics, a capture whose `node_modules/openclaw` junctions to a host directory is removed without touching the host. Without the shim, the same simulation deletes the host.
  - The completion cache and completion install children preload the runtime compatibility shim.
  - `skills-symlink-cleanup` removes skill links and stale runtime cache roots with `safeRmSync`.
  - Capability consent calls `openclaw config validate --json` only when consent is pending. An invalid result returns `deferred` without running `plugins enable` or writing the cache.
docs:
  required: true
---

OpenClaw's capture cleanup uses recursive `fs.rmSync`, and Node 24's native
implementation follows directory junctions on Windows. Plugin captures
junction `node_modules/openclaw` to the bundled runtime. See
`harness/reference/openclaw-2026-10-5-upgrade.md` (Windows: capture cleanup
deleted the bundled OpenClaw) for the field evidence and the timeline.

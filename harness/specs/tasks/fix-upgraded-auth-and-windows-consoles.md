---
id: fix-upgraded-auth-and-windows-consoles
title: Keep provider keys usable after the 2026.10 shared auth relocation and hide Windows runtime consoles
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: After a 0.6.1 → OpenClaw 2026.10.5 in-place upgrade on Windows, custom provider keys appeared unconfigured, and opening a history conversation flashed a black console window. Make ClawX read and write main credentials where OpenClaw 2026.10 keeps them, stop leaving the JSON source that blocks them, and hide the console windows of OpenClaw's runtime children.
touchedAreas:
  - electron/utils/openclaw-auth-sqlite.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-utility-process.ts
  - electron/utils/openclaw-cli.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/acp-chat-service.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/openclaw-upgrade-persistence.md
  - harness/specs/rules/openclaw-runtime-child-processes.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/fix-upgraded-auth-and-windows-consoles.md
expectedUserBehavior:
  - After an upgrade where Doctor relocated the shared auth store, provider keys saved before or after the upgrade stay configured, and OpenClaw no longer reports `AUTH_PROFILE_MIGRATION_REQUIRED` for them.
  - Saving, rotating, or deleting a provider key on the main agent takes effect in OpenClaw, and a deleted key does not come back from a stale JSON copy.
  - On Windows, opening a history conversation or running Gateway and Doctor work does not open console windows.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/acp-chat-service.test.ts
acceptance:
  - With `auth.sharedStore` set to `state-db`, main agent auth reads and writes use `config_machine_state` `authProfiles.store` / `authProfiles.state` inside `BEGIN IMMEDIATE` with an owner recheck, and do not create the main agent database.
  - With no marker or `legacy-main`, main agent auth keeps using the agent database. An invalid marker refuses auth writes.
  - Every successful SQLite auth write retires `auth-profiles.json` to `auth-profiles.json.clawx-retired-<ms>`. The JSON is written only while the agent schema migration is pending.
  - Startup merges a leftover JSON into a `state-db` store without overwriting shared entries, then retires it. A second run reports no change.
  - The runtime compatibility shim defaults `windowsHide: true` for `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync`, and `fork`, including `promisify.custom`, and keeps an explicit `false`.
  - `getOpenClawEmbeddedForkSpec` preloads the compatibility shim with `--import`.
  - Real OpenClaw 2026.10.5 on synthetic homes lists the ClawX-written profile for a fresh home, after Doctor relocation, and after a stale JSON is migrated away.
docs:
  required: true
---

OpenClaw 2026.10 relocates the main agent's shared auth store into the shared
state database and treats an `auth-profiles.json` next to it as an unmigrated
source. ClawX kept writing the old location and the JSON copy, so OpenClaw
blocked the upgraded user's custom providers. OpenClaw re-executes its runtime
without `windowsHide`, and on Windows ClawX's console-less runtime processes
gave each of those children a visible console. See
`harness/reference/openclaw-2026-10-5-upgrade.md` for the ownership rules,
the console mechanism, and the synthetic-home evidence.

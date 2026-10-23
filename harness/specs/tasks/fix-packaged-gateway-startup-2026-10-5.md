---
id: fix-packaged-gateway-startup-2026-10-5
title: Start the packaged OpenClaw 2026.10.5 Gateway from ClawX
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the packaged ClawX 0.7.0 Gateway start on OpenClaw 2026.10.5 by running OpenClaw's runtime re-execs as Node inside Electron utility processes, routing 2026.10.5 maintenance signals to the startup doctor repair, and writing only the 2026.10.5 config shape.
touchedAreas:
  - electron/utils/openclaw-utility-process.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/supervisor.ts
  - electron/gateway/startup-recovery.ts
  - electron/gateway/config-sync.ts
  - electron/utils/openclaw-doctor.ts
  - electron/utils/control-ui-device-pairing.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-compaction.ts
  - electron/utils/openclaw-memory-search.ts
  - electron/utils/openclaw-media-models.ts
  - electron/utils/openclaw-image-generation.ts
  - electron/utils/openclaw-image-generation-runtime.ts
  - electron/utils/openclaw-agent-roster.ts
  - electron/utils/agent-config.ts
  - electron/utils/openclaw-workspace.ts
  - electron/shared/providers/model-capabilities.ts
  - src/components/settings/ImageGenerationSettings.tsx
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-compaction.test.ts
  - tests/unit/openclaw-memory-search.test.ts
  - tests/unit/openclaw-image-generation.test.ts
  - tests/unit/openclaw-agent-roster.test.ts
  - tests/unit/agent-config.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/tasks/fix-packaged-gateway-startup-2026-10-5.md
expectedUserBehavior:
  - A packaged ClawX install starts the OpenClaw 2026.10.5 Gateway instead of failing with the generic "The CLI command failed." exit 1 after the state-snapshot admission phase.
  - On the first launch over 2026.7.1 state, ClawX runs one offline doctor repair for the state and agent database migrations and legacy config keys, then the Gateway starts.
  - Settings → Run Doctor, Run Doctor Fix, and Control UI device pairing work in packaged builds.
  - Fresh installs and existing multi-agent rosters keep working; ClawX no longer writes keys that OpenClaw 2026.10.5 rejects.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-memory-search.test.ts
  - tests/unit/openclaw-image-generation.test.ts
  - tests/unit/openclaw-agent-roster.test.ts
  - tests/unit/agent-config.test.ts
acceptance:
  - The Gateway, startup doctor repair, Run Doctor, and device pairing fork OpenClaw through `forkOpenClawUtilityProcess`, whose bootstrap sets `ELECTRON_RUN_AS_NODE=1` only for spawn/spawnSync/execFile/execFileSync of `process.execPath`, converts `file:` URL module paths passed to `fork()` into paths, and leaves other commands and the utility process environment unchanged.
  - Under a real Electron 41 `utilityProcess`, `doctor --fix` migrates every agent database of a 2026.7.1 state tree instead of refusing `media-persistence`.
  - Under a real Electron 41 `utilityProcess`, the packaged 2026.10.5 Gateway reaches `/health` live with the bootstrap and reproduces the generic exit 1 without it.
  - "`OpenClaw config is invalid`, `config needs correction`, `Legacy config keys detected`, and `gateway.maintenance_required` trigger the one-shot doctor repair, which allows 10 minutes for database migrations."
  - Launch-time writers emit `tools.exec.mode`, `skills.workshop.autonomous.mode`, `session.reset`, root `memory.search`, `agents.defaults.mediaModels.image`, and keyed `agents.entries` with explicit ownership for multi-agent rosters, and never write `reserveTokensFloor`, `identifierInstructions`, or `mediaGenerationAutoProviderFallback`.
  - Config written by ClawX for fresh and doctor-migrated state passes `openclaw config validate` for the bundled 2026.10.5 runtime.
  - Full unit suite (excluding the pre-existing DingTalk `node:sqlite` bundling failures in `config-sync.test.ts`), typecheck, lint, communication replay/compare, and harness validation pass.
docs:
  required: true
---

Follow-up to `upgrade-openclaw-2026-10-5`. The upgrade's packaging evidence ran
`openclaw.mjs` on the ClawX Helper with `ELECTRON_RUN_AS_NODE=1`, which bypasses
the Electron `utilityProcess` launch path ClawX actually uses, so the re-exec
failure and the mandatory 2026.10.5 state migration only surfaced in the
installed 0.7.0-beta.1 build. See `harness/reference/openclaw-2026-10-5-upgrade.md`
for the bootstrap design, the first-launch migration flow, and the config-shape
map.

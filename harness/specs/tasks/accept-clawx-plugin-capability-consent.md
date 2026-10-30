---
id: accept-clawx-plugin-capability-consent
title: Record OpenClaw capability consent for ClawX-shipped plugin mirrors
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove OpenClaw 2026.10's `requires capability consent` warning for the path-owned plugin mirrors ClawX ships, by letting OpenClaw record acceptance before Gateway start, without enabling plugins or slowing ordinary launches.
touchedAreas:
  - electron/utils/plugin-capability-consent.ts
  - electron/utils/openclaw-command.ts
  - electron/utils/openclaw-doctor.ts
  - electron/utils/plugin-install.ts
  - electron/utils/plugin-install-index.ts
  - electron/gateway/config-sync.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/tasks/accept-clawx-plugin-capability-consent.md
expectedUserBehavior:
  - After ClawX installs or upgrades DingTalk, WeCom, Feishu, QQ Bot, or the OpenAI image relay mirror, `openclaw plugins list` no longer reports `requires capability consent` for the enabled ones.
  - Launches where no ClawX mirror or OpenClaw runtime changed do not run the consent CLI.
  - Disabled, denied, non-allowlisted, and user-installed plugins are never enabled or consented by ClawX.
  - A consent failure leaves only OpenClaw's status warning. It is logged, attempted once per install fingerprint, and never blocks Gateway start.
  - Settings > Advanced > Developer > Run Doctor keeps its existing behavior on the shared OpenClaw command runner.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/plugin-install-index.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/config-sync.test.ts
acceptance:
  - Prelaunch runs `openclaw plugins enable <ids...> --accept-capabilities` after trusted install records are final and before Gateway spawn, only for enabled ClawX path-owned mirrors whose record fingerprint changed.
  - ClawX never writes `acceptedSurface*` fields itself; acceptance comes from OpenClaw's own normalized surface.
  - A non-zero batch retries the remaining ids individually, a timeout does not retry, and every attempted fingerprint is cached.
  - An already-current acceptance that OpenClaw leaves untouched counts as accepted after a successful command.
  - A synthetic OpenClaw 2026.10.5 home with all ClawX mirrors goes from five consent warnings to none, the next launch is a cache hit, `config validate` stays valid, and the Gateway reaches `ready`.
docs:
  required: true
---

OpenClaw 2026.10 requires capability consent for installed plugins that are
not trusted official installs, and ClawX's path-owned mirrors never qualify.
The accepted surface hash depends on OpenClaw's normalized manifest metadata,
so ClawX delegates acceptance to the OpenClaw CLI and only decides when to ask.
See `harness/reference/openclaw-2026-10-5-upgrade.md` for timing, scope, and
synthetic evidence.

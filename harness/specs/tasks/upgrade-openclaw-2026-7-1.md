---
id: upgrade-openclaw-2026-7-1
title: Upgrade the bundled OpenClaw runtime to 2026.7.1
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep ClawX runtime and bundled channel plugins aligned with OpenClaw 2026.7.1 across supported platforms.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - scripts/download-bundled-node.mjs
  - harness/specs/tasks/upgrade-openclaw-2026-7-1.md
expectedUserBehavior:
  - ClawX starts and communicates with the bundled OpenClaw 2026.7.1 Gateway.
  - Bundled official channel plugins use versions compatible with OpenClaw 2026.7.1.
  - Packaged Windows builds use a Node runtime that satisfies OpenClaw 2026.7.1 engine requirements.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
acceptance:
  - The OpenClaw dependency and official OpenClaw channel plugins are pinned to 2026.7.1.
  - The lockfile resolves OpenClaw and the official channel plugins at 2026.7.1 without incompatible peers.
  - The bundled Windows Node version satisfies OpenClaw 2026.7.1's declared engine range.
  - Type checks, targeted runtime tests, and communication regression checks pass.
docs:
  required: false
---

Use this task spec for the coordinated runtime, official plugin, lockfile, and
Windows Node baseline upgrade required by OpenClaw 2026.7.1.

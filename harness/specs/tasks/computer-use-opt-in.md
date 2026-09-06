---
id: computer-use-opt-in
title: Optional Computer Use management
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make local Computer Use explicitly opt-in with persistent default-off policy and read-only permission management.
touchedAreas:
  - electron/**
  - shared/**
  - src/**
  - tests/**
  - harness/**
  - resources/openclaw-plugins/clawx-cua-computer/**
  - scripts/after-pack.cjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/download-cua-driver.mjs
  - electron-builder.yml
  - package.json
  - pnpm-workspace.yaml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Computer Use defaults off including existing installations without an explicit preference.
  - Startup and activation never request permissions; only an explicit enabled permission action may do so.
  - A sidebar management page shows the persistent toggle and read-only macOS permission states.
  - Disabling stops the driver and removes the computer plugin from agent availability.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cua-runtime.test.ts
  - tests/unit/computer-use-api.test.ts
  - tests/unit/computer-use-settings.test.ts
  - tests/e2e/computer-use.spec.ts
acceptance:
  - Computer Use toggles preserve unrelated plugin allowlist availability; disabling never removes allow entries, and enabling extends only an already nonempty allowlist.
  - Main serializes preference changes and runtime reconciliation and uses the config coordinator for plugin policy.
  - Disabled calls cannot load the privileged SDK or request permissions, even on activation.
  - All management text is translated into en, zh, ja, and ru and renderer uses host-api.
  - Tests do not invoke real OS permission prompts or desktop control.
docs:
  required: true
---

# Optional Computer Use

The bundled OpenClaw plugin exposes a computer tool over a local MCP proxy,
not an installed Skill. No Skill is added by this task.

The task builds on the branch's bundled-driver implementation; its packaging
paths are included because harness validation reviews the full branch diff.
See `harness/reference/computer-use.md` for lifecycle and permission decisions.

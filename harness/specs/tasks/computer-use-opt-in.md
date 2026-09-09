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
  - resources/skills/computer-use/**
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
  - The Developer Mode-gated sidebar management page shows the persistent toggle and read-only macOS permission states.
  - Disabling stops the Main-owned driver and removes its private CLI endpoint descriptor without revoking OS grants.
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
  - Computer Use toggles do not install plugins or mutate plugin allowlists, global exec approvals, or sandbox policy.
  - Main serializes preference changes and runtime reconciliation with failed-opt-in rollback, without promising global action serialization or native cancellation.
  - Disabled calls cannot load the privileged SDK or request permissions, even on activation.
  - All management text is translated into en, zh, ja, and ru and renderer uses host-api.
  - Tests do not invoke real OS permission prompts or desktop control.
docs:
  required: true
---

# Optional Computer Use

The plugin/MCP transport and live plugin-policy mutation requirements of this
original task are superseded by `harness/specs/tasks/cua-driver-cli.md`. The
default-off preference, management API, explicit permission flow, and developer
gate remain active requirements. Existing OpenClaw exec/read uses Main's CLI
endpoint; `/computer-use` supplies guidance, not authorization.

The task builds on the branch's bundled-driver implementation; its packaging
paths are included because harness validation reviews the full branch diff.
See `harness/reference/computer-use.md` for lifecycle and permission decisions.

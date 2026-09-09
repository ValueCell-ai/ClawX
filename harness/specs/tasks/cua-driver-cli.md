---
id: cua-driver-cli
title: Native CUA CLI through computer-use
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the custom computer plugin and MCP adapter with native bundled CUA CLI calls while retaining Main-owned opt-in and the computer-use Skill name.
touchedAreas:
  - electron/**
  - resources/openclaw-plugins/clawx-cua-computer/**
  - resources/skills/computer-use/**
  - src/pages/ComputerUse/**
  - shared/i18n/locales/**
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - scripts/**
  - shared/host-api/contract.ts
  - src/App.tsx
  - src/components/layout/Sidebar.tsx
  - src/lib/host-api.ts
  - src/pages/Chat/AcpToolCallCard.tsx
expectedUserBehavior:
  - Computer Use remains default off with explicit Main-owned permission requests and supervised daemon lifecycle.
  - Selecting /computer-use loads guidance based on the official CUA 0.25.0 Skill under cua-025-upgrade without enabling the service.
  - The model invokes the bundled CLI through existing exec and reads screenshots through existing image-capable read.
  - Native window, element, menu, browser and verification commands are available without a ClawX action subset or MCP proxy.
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
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/unit/cua-runtime.test.ts
  - tests/unit/computer-use-api.test.ts
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/e2e/computer-use.spec.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - The existing EmbeddedCuaDriverHost remains the lifecycle and permission owner with unchanged native package loading.
  - The private descriptor contains v 2, generation, driverVersion, binaryPath and socketPath, not MCP launch instructions.
  - The model-facing custom computer plugin, MCP client and automatic plugin installation/policy hooks are removed.
  - The computer-use name is retained and documentation attributes current guidance to the official 0.25.0 accompanying Skill; the original 0.21.0 source below is historical.
  - Pinned upstream documentation and license ship offline with concise ClawX-specific endpoint, permission, session and image guidance.
  - Skill selection never enables Computer Use, starts a daemon or prompts for OS permissions.
  - CLI examples use explicit Main-owned endpoints, named sessions and inspect results rather than assuming zero exit proves success.
  - Screenshots use fresh local workspace paths and image-capable read; base64 stdout is not treated as model vision.
  - The old internal Skill can be replaced without introducing a general migration system or altering unrelated user configuration.
  - No global shell/sandbox approvals are loosened and no alternate daemon is launched when the endpoint is unavailable.
docs:
  required: true
---

# Native CLI Computer Use

Historical implementation plan: `harness/reference/cua-driver-cli-plan.md`.
This task supersedes the model-facing MCP requirements in the earlier Computer
Use tasks. Main still starts the embedded daemon; the existing OpenClaw exec
tool runs the native CLI against its private endpoint. The SDK is not removed.

The current version/source requirements are in
`harness/specs/tasks/cua-025-upgrade.md`. That task supersedes the 0.21.0 pin,
not Main ownership or the native CLI boundary established here. Installation
ownership is now governed by `harness/specs/tasks/managed-computer-use-skill.md`.

Historical source: the original task used the official Skill from `cua-driver-rs-v0.21.0`, commit
`70db98d1bcd92890d778f4978e0eb107a4b66c1b`, under the existing `computer-use` name.
The former plugin implementation was internal-only; do not build a general
upgrade framework. The managed-Skill task supersedes known-pristine-only upgrades:
replace any differing same-name directory with the current bundle, including user
edits/extras; preserve other-named Skills and settings. Custom variants need another name.
Preserve historical chat presentation and independent vision metadata
fixes. Native permissions, provider image delivery and Windows packaged behavior
must be reported separately from mocked tests.

Validation evidence and remaining native/platform limits:
`harness/reference/computer-use-cli-validation.md`.

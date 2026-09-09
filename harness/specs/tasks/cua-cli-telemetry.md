---
id: cua-cli-telemetry
title: Suppress CUA telemetry console flashes
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Retain the CUA telemetry regression contract; cua-025-upgrade supersedes the historical 0.21.0 CLI-only workaround with supported daemon and CLI overrides.
touchedAreas:
  - .github/workflows/check.yml
  - electron/**
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - resources/**
  - scripts/**
  - shared/**
  - src/**
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - electron-builder.yml
expectedUserBehavior:
  - CUA CLI calls started through ClawX inherit disabled driver telemetry without model-supplied environment overrides.
  - Main's embedded daemon starts with SDK-accepted options without changing OS grants or the user's persistent CUA settings.
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
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/cua-runtime.test.ts
  - tests/unit/cua-cli-exec.test.ts
acceptance:
  - Gateway CLI children explicitly receive CUA_DRIVER_RS_TELEMETRY_ENABLED false on macOS and Windows, overriding inherited opt-in for these children only.
  - Current embedded options include telemetry false under cua-025-upgrade; the SDK allowlist supports it since 0.22.0, superseding the historical 0.21.0 exclusion below.
  - A real native SDK constructor validates the options produced by CuaRuntimeManager on supported hosts without starting a daemon or requesting permissions.
  - The supported-platform CI job runs the native constructor test explicitly; Linux-only full unit runs must not be its sole coverage.
  - Original environment objects and unrelated settings remain unchanged.
  - Actual OpenClaw exec inheritance carries the flag into CLI children without per-call model intervention.
  - Existing PE patch, SDK lifecycle, permission checks, tools, and direct CLI protocol remain unchanged.
  - Windows user-reported A/B evidence is distinguished from local macOS regression tests and pending rebuilt-Windows acceptance.
docs:
  required: true
---

# CUA Telemetry Console Flashes

Current contract: `harness/specs/tasks/cua-025-upgrade.md` pins SDK/driver/Skill
0.25.0 and requires the override in both Main daemon options and Gateway CLI
children. The SDK now permits telemetry variables. Keep the PE patch and native
constructor regression seam; this is not an automatic upstream no-window fix or
new Windows validation. The following 0.21.0 diagnosis and remediation are
superseded history, not instructions to remove the current daemon override.

## Historical 0.21.0 Diagnosis and Remediation

User-reported Windows control: PowerShell alone does not flash; normal bundled
CLI calls flash once each; the same calls with driver telemetry disabled do not;
restoring the original environment restores flashing. Static CUA 0.21.0 source
shows a telemetry worker spawning `cmd /c ver` without a no-window flag. The
experiment isolates the telemetry-enabled path, not the exact console owner.

Set the override on the Gateway, the parent of model CLI executions. Do not pass
it to EmbeddedDriverHostOptions.environment: the real 0.21.0 constructor rejects
it with EmbeddedDriverError.Configuration, even though its generated TypeScript
type accepts arbitrary name/value pairs. The SDK also clears and allowlists its
inherited environment, so a Main process.env override is not an alternative.

The earlier two-path requirement caused a daemon startup regression and was
superseded by this 0.21.0 workaround. Daemon telemetry was left at the SDK/default behavior; CLI
telemetry remains disabled. No persistent telemetry config, system environment,
Windows PE, permissions, or model Skill changes are needed. Broad touched areas
cover inherited branch scope; implementation remains limited to startup options
and tests/docs.

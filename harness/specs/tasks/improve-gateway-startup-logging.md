---
id: improve-gateway-startup-logging
title: Add actionable Gateway startup timing diagnostics
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Capture OpenClaw startup stage timings in ClawX logs so slow Windows model-switch restarts can be attributed to a concrete runtime stage without manual environment setup.
touchedAreas:
  - harness/specs/tasks/improve-gateway-startup-logging.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - electron/gateway/config-sync.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/startup-stderr.ts
  - electron/gateway/manager.ts
  - tests/unit/gateway-startup-stderr.test.ts
  - tests/unit/gateway-process-launcher.test.ts
expectedUserBehavior:
  - Gateway startup behavior is unchanged.
  - Logs include OpenClaw startup stage timings by default.
  - Normal startup trace lines are informational rather than warnings.
  - Slow stages and slow total startup emit concise diagnostics identifying the longest observed stage.
  - Expected readiness probe disconnects do not appear as Gateway warnings.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/gateway-startup-stderr.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - The managed Gateway child receives OPENCLAW_GATEWAY_STARTUP_TRACE=1.
  - ClawX parses duration-bearing OpenClaw startup trace lines without treating ordinary traces as warnings.
  - A stage lasting at least 10 seconds is logged as a slow startup stage.
  - The gateway.startup metric includes a trace summary with stage count, latest stage, and longest stage.
  - A managed Gateway taking at least 30 seconds from spawn to handshake readiness emits one slow-startup summary.
  - Trace totals preserve the largest observed total when OpenClaw starts a nested trace clock.
  - Expected ANSI-colored code=1006 readiness probe closures are downgraded to debug.
  - No renderer transport or Gateway readiness behavior changes.
docs:
  required: false
  reason: Logging-only diagnostics change; user workflows and public interfaces are unchanged.
references:
  - harness/specs/scenarios/gateway-startup-diagnostics.md
---

## Scope

- Enable OpenClaw's built-in Gateway startup trace for ClawX-owned child processes.
- Parse duration-bearing trace lines and retain a compact per-process summary.
- Log normal stages at info level, elevate slow stages, and attach the summary to the existing startup metric.
- Remove the ClawX-injected ignored legacy channel environment variable that creates a misleading deprecation warning.

## Out Of Scope

- Changing Gateway reload/restart policy on Windows.
- Changing model selection or provider behavior.
- Sampling user processes or collecting environment values.
- Changing readiness, reconnect, or fallback decisions.

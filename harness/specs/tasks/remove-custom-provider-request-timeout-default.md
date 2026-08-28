---
id: remove-custom-provider-request-timeout-default
title: Stop injecting custom-provider request timeouts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Leave custom-provider request timeout policy to OpenClaw and user-authored provider configuration instead of injecting a ClawX-owned default.
touchedAreas:
  - harness/specs/tasks/remove-custom-provider-request-timeout-default.md
  - harness/specs/tasks/bound-custom-provider-request-timeouts.md
  - harness/specs/rules/custom-provider-request-timeout.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - electron/utils/openclaw-auth.ts
  - tests/unit/openclaw-auth.test.ts
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - New custom providers do not receive a ClawX-authored timeoutSeconds value.
  - Startup synchronization does not add timeoutSeconds to existing custom providers.
  - Per-Agent models.json synchronization does not add timeoutSeconds.
  - Existing explicit timeoutSeconds values remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - provider-model-metadata-preservation
  - gateway-heartbeat-safety
  - openclaw-config-delivery
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - Provider save and startup synchronization leave a missing timeoutSeconds absent.
  - Per-Agent provider synchronization leaves a missing timeoutSeconds absent.
  - Existing finite non-negative timeoutSeconds values are preserved.
  - No Renderer transport or Gateway heartbeat policy changes are introduced.
  - Focused tests, typecheck, harness validation, communication replay, and communication comparison pass.
docs:
  required: true
---

## Background

ClawX briefly injected a per-attempt timeout into `models.providers.custom-*`
entries. Custom endpoints have different latency and retry characteristics, so
ClawX must not impose a single provider-level timeout. OpenClaw defaults and
explicit user configuration remain authoritative.

## Scope

- Remove the custom-provider timeout constant and all missing-value injection.
- Stop startup backfill in `openclaw.json`.
- Stop timeout injection into per-Agent `models.json`.
- Preserve timeout values already present in provider configuration.
- Remove documentation and harness rules that advertise a ClawX-owned default.

## Out Of Scope

- Deleting timeoutSeconds values already present in user configuration.
- Changing OpenClaw's timeout or retry behavior.
- Changing Gateway heartbeat or liveness recovery.

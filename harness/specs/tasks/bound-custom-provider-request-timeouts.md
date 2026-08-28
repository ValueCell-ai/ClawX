---
id: bound-custom-provider-request-timeouts
title: Bound custom-provider model requests before Gateway liveness recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent an unresponsive OpenAI-compatible custom provider request from outliving ClawX's Gateway liveness budget and forcing a whole-Gateway restart.
touchedAreas:
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
  - New custom providers receive a bounded model-request timeout without requiring manual openclaw.json edits.
  - Existing custom providers missing a timeout are repaired before Gateway launch.
  - A silent or unreachable custom endpoint fails the model request before ClawX's 180-second no-liveness recovery can restart the whole Gateway.
  - Explicit user-authored provider timeouts remain unchanged.
  - Built-in, local, image-generation, and other non-custom provider entries remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - custom-provider-request-timeout
  - provider-model-metadata-preservation
  - gateway-heartbeat-safety
  - openclaw-config-delivery
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - ClawX-owned models.providers.custom-* entries receive timeoutSeconds=45 when the field is absent.
  - Existing finite non-negative timeoutSeconds values, including zero, are preserved during provider save, default switching, startup sync, and sanitization.
  - The same missing-only default is applied to ClawX-written custom-provider entries in each agent models.json file.
  - Startup batch sync repairs existing models.providers.custom-* entries without touching non-custom providers.
  - With the OpenAI-compatible SDK's default maximum of three HTTP attempts, the 45-second per-attempt bound leaves margin before the 180-second Gateway liveness deadline.
  - No Renderer transport or Gateway heartbeat policy changes are introduced.
  - Focused tests, typecheck, harness validation, communication replay, and communication comparison pass.
docs:
  required: true
---

## Background

An issue report from ClawX 0.5.5 showed a custom OpenAI-compatible model finishing two local read tool calls and then becoming silent during the continuation request. The provider entry had no timeoutSeconds. After 180 seconds without a Gateway frame or pong, ClawX's bounded liveness recovery issued its five-second system-presence probe and restarted the unresponsive owned Gateway. The restart mechanism behaved correctly, but the provider request should have failed within the model layer first.

OpenClaw applies models.providers.*.timeoutSeconds to provider HTTP connect, headers, body, and stream-idle handling. Its OpenAI-compatible client can make up to three attempts by default, so a 45-second per-attempt default keeps the aggregate silent-provider failure below the Gateway's 180-second control-plane deadline while still allowing active streams to continue as their timeout is refreshed by data.

## Scope

- Apply timeoutSeconds=45 to newly written models.providers.custom-* entries when no timeout is already present.
- Backfill the same timeout on existing custom-provider entries in openclaw.json during prelaunch batch sync.
- Apply the default to ClawX-maintained custom-provider entries in agent models.json files.
- Preserve every explicit timeout value and every non-custom provider entry.
- Document the bounded default and add regression coverage.

## Out Of Scope

- Changing the three-minute Gateway liveness deadline or its system-presence verification.
- Disabling provider SDK retries globally.
- Adding a timeout editor to Renderer settings.
- Overriding explicit custom-provider timeouts.
- Applying the chat-provider default to the separate clawx-openai-image provider.

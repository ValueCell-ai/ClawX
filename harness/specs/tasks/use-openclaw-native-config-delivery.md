---
id: use-openclaw-native-config-delivery
title: Use OpenClaw-native config delivery and restart planning
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make one Main-owned coordinator the only ClawX path for OpenClaw config mutation, using config.get and config.set while running and a file fallback before startup.
touchedAreas:
  - harness/specs/tasks/use-openclaw-native-config-delivery.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/reference/openclaw-config-delivery.md
  - electron/gateway/config-delivery.ts
  - electron/gateway/manager.ts
  - electron/gateway/ws-trace.ts
  - electron/main/index.ts
  - electron/main/ipc-handlers.ts
  - electron/services/agents-api.ts
  - electron/services/channels-api.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/utils/channel-config.ts
  - electron/utils/agent-config.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/openclaw-image-generation.ts
  - electron/utils/plugin-install.ts
  - electron/utils/skill-config.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-image-generation.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Saving providers, agents, channels, bindings, skills, or other hot-applicable OpenClaw configuration does not replace the Gateway process.
  - Every ClawX mutation of the active OpenClaw config goes through one coordinator-owned read-modify-write transaction.
  - A running Gateway mutation uses config.get as its baseline and config.set as its commit instead of writing the file directly.
  - Saving config while the Gateway is stopped does not start it.
  - Proxy and other process-launch environment changes still replace the running Gateway process.
  - Manual restart and health/crash recovery behavior remains available.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-config-delivery
  - gateway-readiness-policy
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-ws-trace.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/provider-runtime-sync.test.ts
acceptance:
  - Electron Main owns config delivery; Renderer does not add direct Gateway transport calls.
  - A running Gateway mutation prefers the runtime-shaped config.get `config` object as its baseline, applies its mutator, and commits the serialized result with config.set and the returned hash as baseHash; source-shaped `raw` is only a compatibility fallback.
  - Successful config.set delivery does not send SIGUSR1 and does not call GatewayManager.restart.
  - The coordinator serializes mutations and retries one base-hash conflict from a fresh config.get snapshot.
  - When Gateway is stopped or starting, the same coordinator performs the mutation against the resolved file path and does not start the Gateway.
  - A non-conflict RPC mutation failure does not perform an out-of-band file write; it fails the mutation without silently diverging live and persisted config.
  - Provider deletion, OAuth completion, Agent deletion, Channel save/delete/binding, skill config, image config, and hidden self-heal writes do not carry independent blanket restart policy.
  - Deleting a custom default Channel account does not recreate its mirrored top-level credentials under a literal `default` account.
  - Channel account deletion removes matching credentials from plugin-backed account mirrors, including Agent deletion paths.
  - Gateway WebSocket traces redact serialized raw config-write payloads before logging them.
  - Proxy environment changes, manual restart, heartbeat recovery, process crash recovery, app update, and app shutdown/startup retain their lifecycle behavior.
  - No production helper outside the coordinator writes the active OpenClaw config file.
  - Coordinator file fallback uses the configured OpenClaw config path rather than a hardcoded home-directory path.
docs:
  required: true
---

Use this task spec for the OpenClaw 2026.7.1 config-delivery convergence change.

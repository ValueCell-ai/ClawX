---
id: activate-plugin-channel-after-save
title: Activate plugin channels after first-enable
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: After a first-enable or re-enable of a plugin-backed channel, wait briefly for OpenClaw's native reload and force one ClawX-owned Gateway restart only if the channel never appears in channels.status, so DingTalk can receive messages and WeChat QR login finishes connected without a second restart race or a false error when the config.set acknowledgement is lost to OpenClaw's code-1012 reload.
touchedAreas:
  - electron/services/plugin-channel-activation.ts
  - electron/services/channels-api.ts
  - electron/gateway/config-delivery.ts
  - electron/utils/channel-status.ts
  - src/lib/channel-status.ts
  - src/pages/Channels/index.tsx
  - tests/unit/plugin-channel-activation.test.ts
  - tests/unit/channel-status.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/e2e/channels-plugin-activation-status.spec.ts
  - harness/specs/tasks/activate-plugin-channel-after-save.md
  - harness/specs/tasks/optimize-channel-save-latency.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/scenarios/gateway-backend-communication.md
expectedUserBehavior:
  - Saving credentials for a plugin channel that is already live in channels.status returns without a ClawX full restart.
  - Saving a new DingTalk (or other unloaded plugin) account waits briefly for OpenClaw reload, then forces one Gateway restart if the channel is still missing so Stream starts without the 300s reply-drain delay.
  - Scanning personal WeChat after delete/re-login awaits the same activator and does not schedule a second debouncedRestart on top of config.set.
  - A WeChat QR login or plugin save whose config.set acknowledgement is lost to OpenClaw's in-process restart still succeeds: the persisted file is accepted when it differs only by OpenClaw's auto-managed meta stamp and restored redaction sentinels, and otherwise the pure mutator is replayed through the durable file path.
  - A forced Gateway restart that fails, or a Gateway that is still loading plugins after a native reload, never turns a committed save or QR login into an error toast.
  - A configured plugin channel that is not yet in the runtime snapshot shows Connecting instead of Disconnected while Gateway is healthy.
  - A configured account with `enabled: false` stays Disconnected when it is absent from the runtime snapshot.
  - Activating accountId `default` does not treat a differently named sole runtime account as already live.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - channel-plugin-migration-guards
  - openclaw-config-delivery
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - e2e-parallel-isolation
  - comms-regression
requiredTests:
  - tests/unit/plugin-channel-activation.test.ts
  - tests/unit/channel-status.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/e2e/channels-plugin-activation-status.spec.ts
acceptance:
  - ensurePluginChannelRuntimeActivated returns already-live without restart when channels.status already has the account.
  - The activator polls for a short window and does not restart while Gateway is reconnecting, starting, or running with gatewayReady still false, or when every channels.status read failed.
  - A still-missing account after the wait window causes exactly one gatewayManager.restart(); a rejected restart is logged and returns unavailable instead of throwing.
  - Changed plugin saveConfig awaits the activator and does not call debouncedRestart(0) when peer link repair succeeds.
  - WeChat QR success emits only after the activator finishes and never calls scheduleGatewayRestartForPluginChannel.
  - A config.set reply lost to "Gateway service restart" is accepted when the persisted file matches the submitted config ignoring meta.lastTouchedAt, meta.lastTouchedVersion, and __OPENCLAW_REDACTED__ sentinels; an unverifiable loss or a config.get rejected by the restart replays the mutator through mutateFileConfig instead of failing the caller.
  - File replay restores any `__OPENCLAW_REDACTED__` fields from the pre-mutator durable snapshot before persisting, so a redacted running-Gateway edit cannot overwrite real secrets.
  - ensurePluginChannelRuntimeActivated does not treat a named sole runtime account as the requested `default`.
  - Configured-but-absent runtime rows report connecting, not disconnected, unless the account or channel section is disabled.
docs:
  required: false
---

Use this task spec when first-enable or re-enable of a plugin-backed
channel must become reachable without waiting for OpenClaw's reply-drain
restart deferral, and without stacking a second ClawX restart on a native
code-1012 reload.

This also references `gateway-backend-communication` because activation
is Main-owned: renderer still uses host-api/channels and must not talk to
Gateway HTTP or implement protocol switching.

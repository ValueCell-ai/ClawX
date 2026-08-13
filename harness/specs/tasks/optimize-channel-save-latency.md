---
id: optimize-channel-save-latency
title: Return promptly after durable channel saves while activation continues
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reduce the time the channel configuration modal remains blocked by returning after configuration and binding commits, while plugin activation uses one Gateway lifecycle path without racing native config reloads.
touchedAreas:
  - harness/specs/tasks/optimize-channel-save-latency.md
  - harness/specs/tasks/fix-supported-channel-connectivity.md
  - harness/specs/tasks/remove-unsupported-channel-catalog-entries.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/rules/openclaw-config-delivery.md
  - harness/reference/openclaw-config-delivery.md
  - shared/host-api/contract.ts
  - shared/types/channel.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - electron/services/channels-api.ts
  - electron/gateway/config-delivery.ts
  - electron/gateway/manager.ts
  - electron/gateway/startup-orchestrator.ts
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/plugin-install.ts
  - src/components/channels/ChannelConfigModal.tsx
  - src/pages/Channels/index.tsx
  - tests/unit/channel-config.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-plugin-save.spec.ts
  - tests/e2e/channels-supported-catalog.spec.ts
expectedUserBehavior:
  - Saving a plugin-backed channel returns as soon as its configuration and scoped binding are durably committed instead of waiting for Gateway stop, startup, and readiness.
  - The Channels page immediately reloads the committed local configuration and then converges to runtime connection state after the scheduled Gateway restart.
  - Changed plugin configuration uses OpenClaw's native config reload without an additional ClawX full restart when OpenClaw peer link repair succeeds; a failed peer link repair schedules the guarded restart path after the config commit, and no-change retries still use that path when plugin discovery is required.
  - A config commit whose acknowledgement is lost to native reload is verified from the durable config instead of being reported as a false save failure.
  - A stale owned process that fails to recover from an in-process restart is terminated promptly and replaced instead of holding startup for the full cold-start retry budget.
  - Restart failures remain visible through normal Gateway status and logging rather than becoming unhandled promise rejections.
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
  - docs-sync
requiredTests:
  - tests/unit/agent-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/gateway-config-delivery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-plugin-save.spec.ts
acceptance:
  - The save response exposes when plugin activation is pending.
  - A changed plugin config relies on the coordinator-owned config.set reload without a redundant full restart when peer link repair succeeds, and schedules a guarded full restart after commit when peer link repair fails.
  - A no-change plugin save starts a guarded Gateway restart only after the scoped binding commit completes.
  - The save response does not await Gateway restart readiness.
  - Immediate post-save refresh is config-only and does not issue an expensive runtime probe while Gateway is restarting.
  - No Renderer transport or direct Gateway request is added.
docs:
  required: false
---

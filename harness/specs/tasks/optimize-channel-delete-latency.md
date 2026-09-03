---
id: optimize-channel-delete-latency
title: Make channel deletion responsive while preserving durable cleanup
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove a deleted channel or account from the Channels UI immediately after confirmation while Main completes the durable OpenClaw configuration and binding cleanup.
touchedAreas:
  - harness/specs/tasks/optimize-channel-delete-latency.md
  - harness/specs/tasks/optimize-channel-save-latency.md
  - harness/specs/tasks/fix-supported-channel-connectivity.md
  - harness/specs/tasks/remove-unsupported-channel-catalog-entries.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - shared/host-api/contract.ts
  - shared/types/channel.ts
  - shared/i18n/locales/en/channels.json
  - shared/i18n/locales/zh/channels.json
  - shared/i18n/locales/ja/channels.json
  - shared/i18n/locales/ru/channels.json
  - electron/services/channels-api.ts
  - electron/utils/channel-config.ts
  - electron/utils/openclaw-auth.ts
  - src/components/channels/ChannelConfigModal.tsx
  - src/pages/Channels/index.tsx
  - tests/unit/agent-config.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-plugin-save.spec.ts
  - tests/e2e/channels-supported-catalog.spec.ts
  - tests/e2e/channels-delete-latency.spec.ts
expectedUserBehavior:
  - Confirming deletion closes the confirmation dialog and removes the target row immediately instead of blocking on Gateway/OpenClaw configuration delivery.
  - Main still durably deletes the channel configuration and associated binding.
  - A failed deletion reports an error and refreshes the file-backed channel view to restore the actual state.
  - Runtime convergence refresh remains asynchronous and does not block the delete interaction.
  - Stale channel-status events received while OpenClaw stops an adapter do not restore the optimistically deleted channel or account.
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
  - tests/unit/channels-page.test.tsx
  - tests/e2e/channels-delete-latency.spec.ts
acceptance:
  - The UI applies deletion optimistically before the host delete promise settles.
  - The host delete request remains the only mutation path; Renderer does not edit OpenClaw configuration directly.
  - Failure triggers a config-only refresh rather than leaving stale optimistic state.
  - Pending deletion tombstones suppress stale runtime snapshots until a post-commit runtime response confirms that the target is absent.
  - No direct Renderer Gateway request or new transport path is added.
docs:
  required: false
---

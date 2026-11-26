---
id: repair-upgraded-weixin-cron
title: Keep scheduled tasks available during upgrade catch-up and surface WeChat delivery failures
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Admit manual runs after scheduler initialization even when an overdue task is still executing, and preserve the WeChat delivery outcome of a completed task.
touchedAreas:
  - patches/**
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - electron/gateway/config-sync.ts
  - electron/utils/plugin-install.ts
  - electron/services/cron-api.ts
  - shared/types/cron.ts
  - src/pages/Cron/**
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/fixtures/**
  - tests/e2e/cron-*.spec.ts
  - harness/**
  - README*.md
expectedUserBehavior:
  - A slow overdue task can finish under normal scheduler supervision while other run requests are acknowledged.
  - Operators can identify a rejected WeChat notification and refresh the original conversation before the next scheduled delivery.
  - An explicit iLink rejection of a single text message can use the existing bounded delivery retry. A successful retry sends the original result without executing the task again.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - channel-plugin-migration-guards
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-cron-catchup-startup.test.ts
  - tests/unit/cron-schedule.test.ts
  - tests/unit/plugin-mirror-replace.test.ts
  - tests/unit/weixin-cron-delivery-retry.test.ts
  - tests/unit/openclaw-weixin-cron-queue.test.ts
  - tests/unit/openclaw-061-cron-upgrade.test.ts
  - tests/e2e/cron-delivery-targets.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Account migration and queue persistence finish before startup reports success.
  - Long-running catch-up work remains tracked, deduplicated and subject to shutdown and cancellation.
  - Keep the generated result available when delivery fails. Preserve delivery uncertainty and avoid automatic duplicate sends.
  - Apply the connector fix to existing 2.4.10 mirrors on upgrade. Preserve account state and recipient casing.
docs:
  required: true
---

On the first upgraded launch, an overdue job ran a script that sleeps for 300 seconds with a 300-second tool timeout. The next attempt used 600 seconds and was interrupted by Gateway shutdown. The Gateway's manual-run handler awaited scheduler startup, which in turn awaited the overdue job's completion. Three queued launches subsequently lost their caller authority during shutdown.

After restart, four text announcements reached iLink and returned `sendMessage ret=-2 errmsg=prepare failed`. The stored account, case-sensitive recipient and conversation token matched the upgrade snapshot. The response alone does not identify a token lifetime. A recipient message has restored outbound delivery in [upstream field reports](https://github.com/Tencent/openclaw-weixin/issues/309).

The regression exercises the pinned connector and the real SQLite delivery queue with simulated iLink responses. It checks that a refreshed conversation permits the pending text to be sent once. The task card shows the recorded outcome at the end of the run, which can precede a later queue receipt.

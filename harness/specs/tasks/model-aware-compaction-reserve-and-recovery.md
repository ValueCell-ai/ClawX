---
id: model-aware-compaction-reserve-and-recovery
title: Apply model-aware compaction reserve and protect active compaction from Gateway recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep OpenClaw compaction requests below the active model's usable context budget and prevent ClawX liveness recovery from aborting an observed in-progress compaction.
touchedAreas:
  - docs/plans/2026-08-24-model-aware-compaction-recovery.md
  - harness/specs/tasks/model-aware-compaction-reserve-and-recovery.md
  - harness/specs/rules/gateway-heartbeat-safety.md
  - electron/utils/openclaw-auth.ts
  - electron/utils/agent-config.ts
  - electron/gateway/manager.ts
  - electron/gateway/recovery-controller.ts
  - electron/gateway/recovery-budget.ts
  - electron/gateway/compaction-activity.ts
  - electron/services/openclaw-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/openclaw-auth.test.ts
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/e2e/developer-mode.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Selecting a model writes agents.defaults.compaction.reserveTokensFloor as 25% of that model's context window, rounded down, regardless of a previous local floor value.
  - Startup configuration sync corrects stale local reserveTokensFloor values using the active default model when its context window is known.
  - Developer Mode displays the currently applied compaction reserve-token floor and its model-aware 25% policy.
  - ClawX does not restart an owned Gateway while its stderr confirms that an OpenClaw compaction is in progress; recovery resumes after compaction ends or after the bounded compaction grace period expires.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - gateway-heartbeat-safety
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/e2e/developer-mode.spec.ts
acceptance:
  - The applied reserveTokensFloor is floor(contextWindow * 0.25) for the selected model and never preserves an older local floor value.
  - Unknown model context windows do not overwrite a known valid floor with an invented value.
  - Developer Mode reads the applied OpenClaw configuration through the host API and is unavailable while Developer Mode is disabled.
  - Gateway recovery requires normal trusted-liveness recovery when no compaction is active, but defers automatic recovery while a bounded observed compaction is active.
  - Compaction end signals clear the recovery deferral; a missing end signal cannot block recovery indefinitely.
  - Renderer code uses host-api only; it does not read OpenClaw configuration directly.
docs:
  required: true
---

## Background

OpenClaw's global compaction reserve defaults are too small for a 272k-token
model behind a slow provider. The resulting compaction can exceed the fixed
timeout. ClawX also owns the Gateway liveness restart policy, which must not
abort an observed compaction before OpenClaw can finish it.

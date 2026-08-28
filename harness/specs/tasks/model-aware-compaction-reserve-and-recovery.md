---
id: model-aware-compaction-reserve-and-recovery
title: Apply model-aware compaction reserve and protect active compaction from Gateway recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep OpenClaw compaction requests below the active model's usable context budget and prevent ClawX liveness recovery from aborting an observed in-progress compaction.
touchedAreas:
  - patches/openclaw@2026.7.1-2.patch
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - docs/en-US/features.md
  - docs/zh-CN/features.md
  - docs/ja-JP/features.md
  - docs/ru-RU/features.md
  - harness/specs/tasks/model-aware-compaction-reserve-and-recovery.md
  - harness/specs/tasks/custom-provider-context-window-defaults.md
  - harness/specs/tasks/show-acp-context-usage.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/gateway-heartbeat-safety.md
  - harness/specs/rules/compaction-context-progress.md
  - harness/specs/rules/active-config-guards.md
  - harness/specs/rules/provider-model-metadata-preservation.md
  - electron/shared/providers/model-capabilities.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/agent-config.ts
  - shared/types/agent.ts
  - src/pages/Chat/ChatInput.tsx
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
  - tests/unit/agent-config.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/compaction-activity.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-compaction.test.ts
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/e2e/developer-mode.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Selecting a model writes agents.defaults.compaction.reserveTokensFloor as 25% of an explicitly configured effective context window, rounded down; when the selected model has no explicit contextWindow or contextTokens, it writes the conservative 50000-token fallback instead of inferring a limit from the model name.
  - The chat context meter immediately uses the newly selected model's effective context window instead of retaining the previous model's ACP-reported limit.
  - Transport ceilings, including the 272k ChatGPT subscription limit, apply even when a configured model row advertises a larger native context window.
  - Startup configuration sync corrects stale local reserveTokensFloor values using the active default model's explicit context metadata, or resets the floor to 50000 when that metadata is absent.
  - Startup configuration sync overwrites agents.defaults.compaction.recentTurnsPreserve and keepRecentTokens with 0 so completed turns are summarized instead of replayed verbatim after compaction.
  - Developer Mode displays the currently applied compaction reserve-token floor and explains the explicit-context 25% policy plus its 50000-token fallback.
  - ClawX does not restart an owned Gateway while its stderr confirms that an OpenClaw compaction is in progress; recovery resumes after compaction ends or after the bounded compaction grace period expires.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - active-config-guards
  - gateway-heartbeat-safety
  - compaction-context-progress
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - e2e-parallel-isolation
  - docs-sync
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/openclaw-compaction.test.ts
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/provider-model-capabilities.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/chat-input.test.tsx
  - electron/gateway/recovery-controller.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/e2e/developer-mode.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
acceptance:
  - The applied reserveTokensFloor is floor(effectiveContextWindow * 0.25) only when the selected model row explicitly provides a valid contextWindow or contextTokens; otherwise it is 50000 and never preserves an older local floor value.
  - Agent snapshots expose that same effective context window, and the composer recomputes its displayed total and percentage after a model switch even before ACP emits another usage update.
  - The applied recentTurnsPreserve and keepRecentTokens are always 0, including when the local OpenClaw config contains other explicit values.
  - A zero retained-history budget summarizes every completed turn before the persisted compaction boundary is hardened to the compaction entry.
  - Rebuilding context from a zero-tail compaction checkpoint does not replay any completed pre-compaction message verbatim.
  - Missing model context metadata is never replaced by a model-name inference for compaction budgeting, and a missing or malformed model reference uses the 50000-token reserve fallback.
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

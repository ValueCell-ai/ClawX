---
id: fix-cron-result-discovery
title: Discover completed scheduled-task results without reloading ClawX
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Refresh scheduled-task state and the conversation catalog when OpenClaw reports a completed run, because cron.run may acknowledge queueing before a result exists.
touchedAreas:
  - src/stores/gateway.ts
  - src/stores/cron.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/cron-store-fetch-dedupe.test.ts
  - tests/e2e/cron-result-discovery.spec.ts
  - harness/specs/tasks/fix-cron-result-discovery.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/rules/acp-chat-state-and-history.md
expectedUserBehavior:
  - A newly created internal scheduled task appears in the sidebar after its run completes without restarting or reloading the application.
  - Task cards receive the final success or error state after an asynchronous run.
  - Manual and automatic runs use the same completion notification path.
  - Completion arriving during an older list request queues a fresh read instead of leaving stale task state.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - acp-chat-state-and-history
requiredTests:
  - tests/unit/gateway-events.test.ts
  - tests/unit/cron-store-fetch-dedupe.test.ts
  - tests/e2e/cron-result-discovery.spec.ts
acceptance:
  - Valid cron started and finished notifications refresh job state through the typed Host API.
  - A finished notification force-refreshes the authoritative session catalog; run-scoped keys do not become duplicate sidebar conversations.
  - Queue acknowledgment never means task success and no additional cron.run request is issued during reconciliation.
  - No result text is synthesized from generic Gateway notifications; opening the conversation retains ACP replay and the existing authorized cron-history fallback.
  - Regression tests begin without the cron conversation in the catalog and deliver completion only after queue acknowledgment.
  - Tests use synthetic jobs, mocked runtime events, and isolated Electron profiles; no installed ClawX profile is modified or real scheduled task executed.
docs:
  required: false
---

README.md, README.zh-CN.md and README.ja-JP.md were reviewed. This repairs existing
task-result discovery without changing configuration, commands or workflows.

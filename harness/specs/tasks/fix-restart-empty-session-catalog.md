---
id: fix-restart-empty-session-catalog
title: Keep sidebar conversations across an unclean Gateway restart
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Hold gatewayReady until OpenClaw has admitted every agent database so session hydration never reads the empty catalog served during background admission.
touchedAreas:
  - harness/specs/tasks/fix-restart-empty-session-catalog.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - electron/gateway/agent-database-admission.ts
  - electron/gateway/manager.ts
  - electron/gateway/recovery-budget.ts
  - tests/unit/gateway-agent-database-admission.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-recovery-budget.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
expectedUserBehavior:
  - Restarting the Gateway (including the forced restart used on Windows) never empties the sidebar conversation list.
  - While OpenClaw is still admitting agent databases, the sidebar keeps its conversations and shows the restart indicator.
  - Once admission completes, the sidebar reloads the full catalog without user action.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - tests/unit/gateway-agent-database-admission.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-recovery-budget.test.ts
  - tests/e2e/gateway-lifecycle.spec.ts
acceptance:
  - Main publishes gatewayReady true only after loopback /readyz lists no agent-database-inspection-pending entry, bounded by GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS.
  - An unreachable readiness probe or a Gateway without agentDatabases does not delay readiness.
  - Duplicate ready signals during the admission wait produce a single gatewayReady transition.
  - A connection change during the admission wait drops the stale wait.
  - Renderer does not add direct IPC calls or fetch Gateway HTTP directly.
docs:
  required: false
---

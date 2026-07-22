---
id: gateway-hot-config-and-im-decoupling
title: Hot config apply, fast restart, and IM decoupling for the OpenClaw Gateway
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Apply configuration and model changes without full Gateway restarts, shrink required restarts to seconds, and keep IM channel connectivity alive across Gateway lifecycle events.
touchedAreas:
  - harness/reference/gateway-stability-and-hot-reload-redesign.md
  - harness/specs/tasks/gateway-hot-config-and-im-decoupling.md
  - electron/gateway/config-apply-planner.ts
  - electron/gateway/manager.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/startup-orchestrator.ts
  - electron/gateway/supervisor.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/ws-client.ts
  - electron/gateway/restart-controller.ts
  - electron/gateway/restart-governor.ts
  - electron/gateway/lifecycle-controller.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/services/channels-api.ts
  - electron/services/agents-api.ts
  - electron/services/settings-api.ts
  - electron/main/index.ts
  - src/stores/gateway.ts
  - src/pages/Settings/**
  - tests/unit/gateway-config-apply-planner.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/e2e/gateway-config-hot-apply.spec.ts
expectedUserBehavior:
  - Switching the chat model applies within seconds on all platforms without a Gateway restart.
  - Saving provider or channel settings does not drop active IM channel sessions unless the edited channel itself requires reconnection.
  - A genuinely required Gateway restart shows staged readiness progress instead of a long opaque connecting state.
  - Gateway restarts triggered by configuration changes complete in seconds, not minutes, after first-run provisioning.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - channel-plugin-migration-guards
  - active-config-guards
  - provider-default-invariant
  - provider-model-selection-authority
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - tests/unit/gateway-config-apply-planner.test.ts
  - tests/unit/gateway-manager-heartbeat.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/e2e/gateway-config-hot-apply.spec.ts
acceptance:
  - All config mutation call sites route through a single Main-side apply planner that classifies each change as hot, reload, or restart; the classification table is unit-tested and documents why each restart entry cannot be a reload.
  - Reload works on Windows via an RPC (or equivalent) path so no platform silently degrades every reload to a restart.
  - Agent model overrides never trigger a Gateway process restart on any platform.
  - Pre-launch plugin sync and maintenance work is skipped via manifest hashing when inputs are unchanged, and uv/Python warmup runs off the Gateway spawn path.
  - Readiness reports staged milestones (port-ready, handshake-ready, RPC-ready) with a bounded total budget and an explicit degraded state instead of a multi-minute silent wait.
  - Planned config-driven restarts use blue/green swap or otherwise avoid dropping IM channels owned by unaffected channel accounts; channel single-ownership is never violated during cutover.
  - Renderer does not add direct IPC calls, Gateway HTTP fetches, or Gateway WebSocket connections.
  - Comms replay and compare show no regression for send/receive, delivery, or fallback paths.
docs:
  required: true
---

Implements the redesign in `harness/reference/gateway-stability-and-hot-reload-redesign.md`.

Phasing:

1. Phase 1 — hot config apply: introduce `electron/gateway/config-apply-planner.ts`, migrate `provider-runtime-sync.ts`, `channels-api.ts`, `agents-api.ts`, and `settings-api.ts` call sites onto it, add the reload RPC path for Windows parity, and demote forced-restart entries that the pinned OpenClaw version can absorb via reload.
2. Phase 2 — fast/invisible restart: manifest-hash the pre-launch pipeline in `config-sync.ts`, move uv warmup to app bootstrap, add staged readiness milestones with a bounded budget, and add blue/green swap for planner-decided restarts.
3. Phase 3 — IM decoupling: run the channel subsystem as a separately supervised process (or per-channel restart isolation fallback) so agent-runtime restarts no longer drop IM sessions.

Each phase lands as its own PR against this spec, updating `touchedAreas` and `requiredTests` if the concrete file set shifts. Restart-classification demotions must cite the verified OpenClaw reload capability for the pinned runtime version. AGENTS.md and README architecture sections must be updated when phases change user-visible behavior (`docs-sync`).

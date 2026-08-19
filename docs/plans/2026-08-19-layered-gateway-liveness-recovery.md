# Layered Gateway Liveness Recovery Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX's direct "four missed heartbeat responses -> process restart" behavior with evidence-based recovery that reconnects transport first, protects active work, and only restarts an owned Gateway after three minutes without verified liveness.

**Architecture:** Keep Gateway process ownership and lifecycle operations in `GatewayManager`. Add a small Main-process recovery controller that owns the liveness deadline, control-plane probes, transport-only reconnect attempts, and restart escalation; it must never let a missing pong alone terminate a process. Add a workload tracker fed by existing chat lifecycle events and cached `cron.list` results so a pending hard restart runs after work finishes, or at the three-minute deadline.

**Tech Stack:** Electron Main process, TypeScript, `ws`, Vitest, Playwright, ClawX harness.

## Global Constraints

- Renderer remains transport-free: it must use `src/lib/host-api.ts` / `src/lib/api-client.ts` and must not create Gateway WebSockets, call direct IPC, or call Gateway HTTP endpoints.
- Do not use a Gateway HTTP health endpoint. OpenClaw does not guarantee one; use the existing `system-presence` control-plane RPC for active verification.
- A pong, any incoming Gateway frame, and every successful Gateway RPC are trusted liveness signals.
- Liveness suspicion begins after 90 seconds with no trusted signal. The control-plane probe timeout is 5 seconds. The hard-restart deadline is 180 seconds from the last trusted signal, not from the first missed pong.
- A missing pong alone must never invoke `GatewayManager.stop()`, kill a process, or invoke `GatewayManager.restart()`.
- Transport recovery must not spawn or terminate the Gateway process. It must reconnect the WebSocket to the same endpoint first.
- Automatic hard restart applies only to an owned Gateway process. For an externally managed Gateway, keep reconnecting and report unavailability; never issue the external `shutdown` RPC as automated recovery.
- If a local chat/tool run or a cached running cron job exists, defer a hard restart until work completes. Force the hard restart at the same 180-second liveness deadline if work has not completed.
- Explicit user restart, process exit, ordinary WebSocket close, and OpenClaw code-1012 config reload retain their existing lifecycle semantics. The new recovery flow must not duplicate those operations.
- Keep the existing restart governor, but a recovery escalation suppressed by its short cooldown must remain pending and retry after `retryAfterMs`; it must not be silently dropped.
- New user-visible status text must use `react-i18next` and all four maintained locales. Existing status affordances should be reused where possible.
- This changes Gateway/Main communication behavior. Create/update a real task spec under `harness/specs/tasks/`, reference `gateway-backend-communication`, run harness validation before review, then run comms replay and comparison.
- Review and update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` if the documented recovery behavior changes.

## Suspected Gateway Failure Classification

| Signal or situation | Confidence that the process is broken | Required evidence before action | Recovery action | Process restart allowed? | Active-work behavior |
| --- | --- | --- | --- | --- | --- |
| One or more missing pong frames, but a Gateway message or successful RPC arrives | Low; this is a delayed-pong false positive | Incoming frame or RPC success clears suspicion | Reset heartbeat/recovery state; record a recovered false-positive diagnostic | No | Do not interrupt work |
| 90 seconds with no pong, Gateway frame, or RPC success | Low to medium; transport may be stale or Gateway may be busy | Run `system-presence` with a 5-second timeout | Enter `probing`; do not close the socket yet | No | Do not interrupt work |
| `system-presence` succeeds after liveness suspicion | Low | Successful core RPC | Record verified liveness and return to `healthy` | No | Do not interrupt work |
| Core probe fails while WebSocket still appears open | Medium; an open TCP socket is not proof that OpenClaw control plane works | Failed 5-second core RPC | Mark `transport-reconnecting`, reject stale pending transport requests, replace only the WebSocket connection, then retry the bounded probe/reconnect sequence | No | Do not interrupt work |
| WebSocket closes unexpectedly | Medium to high for transport, not necessarily process death | Existing close event and reconnect outcome | Preserve current reconnect path; recover the transport before any escalation | No, unless existing process-exit path proves exit | Do not interrupt work |
| OpenClaw code 1012 close | High confidence of intentional OpenClaw in-process reload | Close code 1012 | Preserve existing reconnect-to-owned-process path; suppress liveness escalation for that generation | No | Do not interrupt work |
| Owned Gateway child process exits unexpectedly | Authoritative | Child process `exit` event | Preserve existing bounded crash recovery/start behavior | Process has already exited | Existing behavior |
| Gateway start fails with invalid config, migration lock, or fatal runtime signal | Authoritative non-retriable startup failure | Existing fatal classification | Preserve current error state and disable automatic start retries | No additional restart | User repairs configuration manually |
| No verified liveness by `lastAliveAt + 180s`, no active workload | High after independent probe and reconnect failures | Deadline plus failed transport recovery | Execute guarded full `GatewayManager.restart()` | Yes, owned process only | No active work to interrupt |
| Probe/reconnect failures continue while active chat/tool/cron workload exists and deadline has not arrived | Medium to high, but user work may still be running | Failed verification plus cached/observed workload | Enter `restart-pending`; restart immediately when work ends | Not yet | Preserve work before deadline |
| No verified liveness by `lastAliveAt + 180s`, active chat/tool/cron workload still exists | High after independent probe and reconnect failures | Deadline plus cached/observed workload | Force the guarded full restart | Yes, owned process only | Bounded interruption at deadline |
| Externally managed Gateway remains unreachable through the deadline | Unknown process ownership; ClawX must not control it | Deadline plus failed transport recovery | Keep status unavailable/reconnecting, surface diagnostics and manual retry | No | Never stop external process |
| User presses Restart Gateway | Explicit user intent | Host API request | Preserve existing immediate guarded `restart()` behavior | Yes, according to existing semantics | User has accepted interruption |

---

### Task 1: Define Liveness And Recovery Policy

**Files:**
- Create: `electron/gateway/recovery-controller.ts`
- Create: `electron/gateway/recovery-controller.test.ts`
- Modify: `electron/gateway/recovery-budget.ts`
- Modify: `electron/gateway/connection-monitor.ts`
- Test: `tests/unit/gateway-connection-monitor.test.ts`

**Interfaces:**
- Consumes: trusted-liveness notifications from `GatewayManager` and configured policy values from `recovery-budget.ts`.
- Produces: `GatewayRecoveryState`, recovery diagnostics, and callbacks requesting a core probe, a transport-only reconnect, or a pending full-restart escalation.

- [ ] **Step 1: Write failing controller tests.** Cover a 90-second silent interval entering `probing`; a successful probe returning to `healthy`; probe failure requesting transport-only recovery; liveness during recovery cancelling timers; and the 180-second deadline requesting one escalation. Use fake timers and an injected clock/callbacks so no Electron or real WebSocket is required.
- [ ] **Step 2: Update connection-monitor tests first.** Change the heartbeat contract from raw fourth-pong-miss recovery to liveness observation: initialize the liveness clock on monitor start, send ping every 30 seconds, and notify the controller only after 90 seconds without `markAlive`. Verify a pong or arbitrary message resets the silence window.
- [ ] **Step 3: Implement policy constants in `recovery-budget.ts`.** Add named constants for 30-second ping interval, 90-second suspicion threshold, 5-second core-probe timeout, bounded transport reconnect delays, and 180-second recovery deadline. Recalculate `ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS` from the new maximum detection/recovery path so accepted prompts are never expired before recovery concludes.
- [ ] **Step 4: Implement `GatewayRecoveryController`.** Make it Main-process-only and callback-driven. Its state must be one of `healthy`, `probing`, `transport-reconnecting`, `restart-pending`, or `restart-executing`. Store a monotonically increasing recovery generation; ignore late probe/reconnect completions from an older generation. The controller must preserve a pending escalation through restart-governor cooldown rather than dropping it.
- [ ] **Step 5: Preserve diagnostic information.** Define a serializable recovery snapshot containing state, `lastAliveAt`, `recoveryStartedAt`, `deadlineAt`, last probe time/result/error, transport reconnect count, restart deferral reason, and escalation reason. Do not record credentials, RPC payloads, or tokens.
- [ ] **Step 6: Run focused tests.** Run `pnpm test -- electron/gateway/recovery-controller.test.ts tests/unit/gateway-connection-monitor.test.ts` and confirm the policy/controller tests pass independently of the existing manager lifecycle tests.
- [ ] **Step 7: Commit the task.** Commit only the policy/controller/tests after the focused tests pass.

### Task 2: Integrate Layered Recovery With GatewayManager

**Files:**
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/gateway/restart-governor.ts`
- Modify: `electron/gateway/restart-controller.ts`
- Modify: `electron/gateway/capability-monitor.ts`
- Modify: `electron/utils/gateway-health.ts`
- Test: `tests/unit/gateway-manager-heartbeat.test.ts`
- Test: `tests/unit/gateway-manager-diagnostics.test.ts`
- Test: `tests/unit/gateway-manager-restart-recovery.test.ts`
- Test: `tests/unit/gateway-restart-governor.test.ts`

**Interfaces:**
- Consumes: `GatewayRecoveryController` callbacks, WebSocket lifecycle callbacks, existing `system-presence` RPC, and Gateway ownership state.
- Produces: transport-only reconnect behavior, guarded owned-process escalation, and extended `GatewayDiagnosticsSnapshot` data.

- [ ] **Step 1: Replace direct heartbeat restart.** In `GatewayManager.startPing()`, route liveness suspicion to `GatewayRecoveryController`; remove the direct `this.restart()` callback after four misses. Retain `consecutiveHeartbeatMisses` for diagnostics, but it must not itself be a process-restart trigger.
- [ ] **Step 2: Register all trusted liveness signals.** On successful handshake, pong, incoming Gateway frame, and successful RPC, call both the existing diagnostics recorder and `recoveryController.recordAlive()`. An incoming event must count even when it is an unknown notification or a non-chat event.
- [ ] **Step 3: Add a bounded core verification method.** Implement a private manager method that calls `rpc('system-presence', {}, GATEWAY_CONTROL_PROBE_TIMEOUT_MS)`. It must report success/failure to the controller, use existing core-RPC failure classification, and never call `stop()` or `restart()` itself.
- [ ] **Step 4: Add transport-only reconnect.** Implement a private recovery method that terminates/replaces only the manager-owned WebSocket, rejects pending requests with a transport-reconnect error, sets lifecycle status to `reconnecting`, and calls the existing socket connection code against the current port. It must not invoke `stop()`, `startProcess()`, port discovery, or process termination. Guard its intentional close so `onCloseAfterHandshake` does not start a second competing reconnect flow.
- [ ] **Step 5: Integrate existing close, process-exit, startup, and code-1012 paths.** Process exit remains authoritative and cancels controller timers. A code-1012 reload remains an in-process reconnect and suppresses stale controller callbacks. Explicit restart, stop, app quit, and a new successful running connection clear recovery state. Do not alter the external Gateway shutdown behavior outside automatic recovery.
- [ ] **Step 6: Gate full escalation by ownership and lifecycle.** When the controller reaches the deadline, invoke guarded `restart()` only if `ownsProcess`, auto-reconnect is enabled, status is `running`/`reconnecting`, and no equivalent restart is already in flight. For external processes, publish `unavailable` diagnostics and continue non-destructive reconnect attempts. If the restart governor cooldown denies the request, schedule retry after its returned delay while retaining the escalation state.
- [ ] **Step 7: Extend diagnostics and health summary.** Add the recovery snapshot to `GatewayDiagnosticsSnapshot`; expose recovery state/reason in `buildGatewayHealthSummary` without treating a single missing pong as an unresponsive process. Preserve current capability-state semantics.
- [ ] **Step 8: Update focused unit tests.** Replace tests asserting “four misses call restart” with the complete flow: event/RPC success prevents recovery; failed probe invokes only transport reconnect; reconnected transport cancels escalation; no liveness by deadline performs exactly one owned-process restart; external process never receives automatic restart; code 1012 and process exit do not double-trigger recovery.
- [ ] **Step 9: Run focused tests.** Run `pnpm test -- tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/gateway-restart-governor.test.ts`.
- [ ] **Step 10: Commit the task.** Commit manager integration and all directly related unit tests.

### Task 3: Track Active Chat And Cron Workloads

**Files:**
- Create: `electron/gateway/workload-tracker.ts`
- Create: `electron/gateway/workload-tracker.test.ts`
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/services/cron-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Test: `tests/unit/host-services.test.ts`
- Test: `tests/unit/gateway-events.test.ts`

**Interfaces:**
- Consumes: normalized `ChatRuntimeEvent` events and successful/fallback `cron.list` job snapshots.
- Produces: `{ activeChatRunCount, activeCronJobCount, hasActiveWorkloads }` for recovery escalation and diagnostics.

- [ ] **Step 1: Write tracker tests.** Cover `run.started` adding a run, every `run.ended` status removing it, duplicate/out-of-order lifecycle events remaining idempotent, cron jobs with `state.runningAtMs` being active, and successful subsequent cron snapshots clearing a completed job.
- [ ] **Step 2: Implement `GatewayWorkloadTracker`.** Track active chat runs by `runId` using the existing normalized `chat:runtime-event` contract. Track cron jobs by id from the latest successful `cron.list` snapshot; fallback-file results are retained conservatively but never treated as proof that a job has ended. Expose only counts/booleans and no user content.
- [ ] **Step 3: Feed chat lifecycle events in Main-owned Gateway code.** Register the tracker where `GatewayManager` receives normalized runtime events, before forwarding them to the renderer, so recovery does not depend on a rendered window or renderer state.
- [ ] **Step 4: Feed cron snapshots.** After `listCronJobs()` obtains Gateway or fallback jobs, pass raw state-derived running job ids to the tracker. During `restart-pending`, request one best-effort fresh `cron.list`; on a failed refresh, retain the previous active set until the hard deadline rather than assuming the job is finished.
- [ ] **Step 5: Connect workload completion to recovery.** On each tracker transition, notify the recovery controller. If a hard restart is pending and all work is now complete before the deadline, execute the guarded owned-process restart immediately. If work remains, retain the deadline timer and force only when it expires.
- [ ] **Step 6: Add diagnostics coverage.** Include both active counts and whether the restart is deferred for work in the manager recovery snapshot. Ensure no renderer-only state is used.
- [ ] **Step 7: Run focused tests.** Run `pnpm test -- electron/gateway/workload-tracker.test.ts tests/unit/gateway-events.test.ts tests/unit/host-services.test.ts`.
- [ ] **Step 8: Commit the task.** Commit workload tracking, Gateway/Cron integration, and tests.

### Task 4: Expose Diagnostics And Preserve User Lifecycle Feedback

**Files:**
- Modify: `electron/services/diagnostics-api.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/pages/Channels/index.tsx`
- Modify: `shared/i18n/locales/en/channels.json`
- Modify: `shared/i18n/locales/zh/channels.json`
- Modify: `shared/i18n/locales/ja/channels.json`
- Modify: `shared/i18n/locales/ru/channels.json`
- Test: `tests/unit/host-services.test.ts`
- Test: `tests/unit/channels-page.test.tsx`
- Test: `tests/e2e/channels-health-diagnostics.spec.ts`
- Test: `tests/e2e/gateway-lifecycle.spec.ts`

**Interfaces:**
- Consumes: the extended manager `GatewayDiagnosticsSnapshot`.
- Produces: typed host diagnostics showing recovery phase/evidence, while retaining the existing Gateway restarting sidebar state and manual restart controls.

- [ ] **Step 1: Write failing service and renderer tests.** Assert `diagnostics.gatewaySnapshot()` contains a sanitized `recovery` object, and Channels diagnostics distinguishes `probing`, transport reconnecting, restart deferred for active work, and external-Gateway unavailable from a completed full restart.
- [ ] **Step 2: Expose typed diagnostics through the existing host path.** Extend the diagnostics result contract and `host-api` types; add the recovery snapshot in `diagnostics-api.ts` without adding a new direct IPC or renderer Gateway connection.
- [ ] **Step 3: Update Channels diagnostics UI minimally.** Reuse existing diagnostic/health surfaces. Add localized explanation only for recovery states that require user interpretation; do not add a new autonomous restart control. Follow design tokens in `src/styles/globals.css`.
- [ ] **Step 4: Update E2E behavior.** In `gateway-lifecycle.spec.ts`, verify a transport-only recovery presents the existing reconnecting state and does not show a process-restart state. In `channels-health-diagnostics.spec.ts`, verify recovery diagnostics are visible and manual restart remains functional.
- [ ] **Step 5: Run focused checks.** Run `pnpm test -- tests/unit/host-services.test.ts tests/unit/channels-page.test.tsx` and `pnpm run test:e2e -- tests/e2e/gateway-lifecycle.spec.ts tests/e2e/channels-health-diagnostics.spec.ts`.
- [ ] **Step 6: Commit the task.** Commit diagnostics contract/UI/locales and E2E coverage.

### Task 5: Update Harness Rules, Documentation, And Validate The Communication Change

**Files:**
- Create: `harness/specs/tasks/layered-gateway-liveness-recovery.md`
- Modify: `harness/specs/tasks/restore-gateway-heartbeat-recovery-after-four-misses.md`
- Modify: `harness/specs/rules/gateway-heartbeat-safety.md`
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify: `harness/specs/scenarios/gateway-startup-diagnostics.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Test: `tests/unit/harness-specs.test.ts`
- Test: `tests/unit/harness-git.test.ts`

**Interfaces:**
- Consumes: finalized recovery timings, ownership restriction, workload deferral behavior, and validation commands from Tasks 1-4.
- Produces: a durable task spec and rule set that prevent future reintroduction of pong-only process restarts.

- [ ] **Step 1: Add the task spec.** Reference scenario `gateway-backend-communication`; list all production/test/doc files; require `gateway-heartbeat-safety`, `gateway-readiness-policy`, backend boundary, comms regression, E2E parallel isolation, and docs sync. State acceptance criteria for 90-second suspicion, 5-second `system-presence` probe, transport-only reconnect, 180-second owned-process escalation, workload deferral, external ownership, and code-1012/process-exit preservation.
- [ ] **Step 2: Supersede the old four-miss task spec.** Mark `restore-gateway-heartbeat-recovery-after-four-misses.md` as historical/superseded by the new task without leaving contradictory acceptance criteria as current policy.
- [ ] **Step 3: Rewrite the heartbeat safety rule.** State that missed pongs are diagnostic only; no missing-pong threshold may directly call `restart()`. Require independent control-plane failure plus the bounded deadline before owned-process escalation, and forbid automatic external Gateway shutdown.
- [ ] **Step 4: Update the Gateway communication and startup-diagnostics scenarios.** Document the Main-owned liveness state machine, trusted liveness evidence, workload deferral, and diagnostics fields. Keep renderer transport restrictions unchanged.
- [ ] **Step 5: Update README translations.** Describe the user-observable policy accurately: Gateway first reconnects safely, protects active work before the three-minute limit, and exposes diagnostics/manual restart. Do not promise that long-running work is never interrupted after the bounded deadline.
- [ ] **Step 6: Validate the harness.** Run `pnpm harness validate --spec harness/specs/tasks/layered-gateway-liveness-recovery.md`, then `pnpm harness run --spec harness/specs/tasks/layered-gateway-liveness-recovery.md`, and run `pnpm run harness:ci`.
- [ ] **Step 7: Run communication regression checks.** Run `pnpm run comms:replay` and `pnpm run comms:compare`; investigate and resolve any new Gateway restart/reconnect regression before proceeding.
- [ ] **Step 8: Run final project checks.** Run `pnpm test -- electron/gateway/recovery-controller.test.ts electron/gateway/workload-tracker.test.ts tests/unit/gateway-connection-monitor.test.ts tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/gateway-events.test.ts tests/unit/host-services.test.ts tests/unit/channels-page.test.tsx tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts`, `pnpm run typecheck`, `pnpm run lint:check`, and `pnpm run test:e2e -- tests/e2e/gateway-lifecycle.spec.ts tests/e2e/channels-health-diagnostics.spec.ts`.
- [ ] **Step 9: Review the diff and commit the task.** Verify no generated files, unrelated changes, credentials, or renderer transport bypasses are included; then commit the harness/docs/validation changes.

## Verification Matrix

| Area | Required verification | Expected result |
| --- | --- | --- |
| Liveness monitor | `tests/unit/gateway-connection-monitor.test.ts` | 90-second silence raises suspicion; any trusted signal resets it; no direct process restart |
| Recovery controller | `electron/gateway/recovery-controller.test.ts` | Probe, transport reconnect, deadline, cancellation, and stale-generation paths are deterministic |
| Gateway lifecycle | Gateway manager unit tests | Probe failure reconnects WebSocket only; owned process restarts only after deadline; external Gateway is never stopped automatically |
| Work protection | Workload tracker/Gateway event/Cron tests | Chat and cached running cron work defer restart until completion or deadline |
| Diagnostics | Host service and Channels unit tests | Recovery evidence is sanitized, typed, and visible through the existing host API |
| User lifecycle | Gateway/Channels E2E | Transport reconnect and full restart states are distinguishable; manual restart remains available |
| Communication regression | `pnpm run comms:replay` and `pnpm run comms:compare` | No unauthorized transport path or restart/reconnect regression |
| Harness and docs | Harness commands and README review | Current policy has no lingering four-miss direct-restart rule |

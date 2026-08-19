# Layered Gateway Liveness Recovery Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX's direct four-missed-pongs restart with a three-minute no-liveness deadline: verify the Gateway control plane once at the deadline, then restart only a ClawX-owned Gateway that still cannot answer.

**Architecture:** `GatewayManager` retains process ownership, WebSocket lifecycle, and the actual guarded restart operation. A small Main-process recovery controller records trusted liveness and owns the one deadline/probe/escalation sequence; it has no workload tracking and never restarts an externally managed Gateway. Existing WebSocket-close, process-exit, manual-restart, and code-1012 reload flows remain independent and continue to use their current recovery paths.

**Tech Stack:** Electron Main process, TypeScript, `ws`, Vitest, Playwright, ClawX harness.

## Global Constraints

- Renderer remains transport-free: it must use `src/lib/host-api.ts` / `src/lib/api-client.ts` and must not create Gateway WebSockets, call direct IPC, or call Gateway HTTP endpoints.
- Do not use a Gateway HTTP health endpoint. Use the existing `system-presence` control-plane RPC for the one active verification at the liveness deadline.
- A pong, any incoming Gateway frame, and every successful Gateway RPC are trusted liveness signals.
- There is no 90-second suspicion or early recovery stage. At 180 seconds since the last trusted signal, run `system-presence` with a 5-second timeout exactly once for that silence period.
- If the deadline probe succeeds, record liveness and resume monitoring without reconnecting or restarting.
- If the deadline probe fails, automatically call guarded `GatewayManager.restart()` only for a Gateway process owned by ClawX. A missing pong alone must never invoke `stop()`, kill a process, or invoke `restart()`.
- For an externally managed Gateway, a failed deadline probe may replace/reconnect ClawX's WebSocket and report unavailability, but must never issue `shutdown`, `stop()`, or `restart()` automatically.
- Do not add chat, tool, cron, or other workload tracking. The three-minute deadline applies regardless of active work.
- Explicit user restart, process exit, ordinary WebSocket close, and OpenClaw code-1012 config reload retain their existing lifecycle semantics. The deadline path must not duplicate those operations.
- Keep the existing restart governor, but a deadline escalation suppressed by its short cooldown must remain pending and retry after `retryAfterMs`; it must not be silently dropped.
- New user-visible status text must use `react-i18next` and all four maintained locales. Reuse current sidebar reconnect/restart affordances where possible.
- This changes Gateway/Main communication behavior. Create/update a real task spec under `harness/specs/tasks/`, reference `gateway-backend-communication`, run harness validation before review, then run comms replay and comparison.
- Review and update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` if the documented recovery behavior changes.

## Recovery Design Matrix

| Design point | Handling | Purpose |
| --- | --- | --- |
| Treat pong, any incoming Gateway frame, and every successful RPC as liveness | Refresh `lastAliveAt`, clear missed-pong diagnostics, and cancel a stale deadline callback | Avoid treating a delayed pong as a dead Gateway when the same connection is serving real traffic |
| Use one three-minute silence deadline | Before 180 seconds, record missed pongs only; do not alter the socket or process | Bound automatic recovery while eliminating the current fourth-miss virtual restart |
| Verify the control plane at the deadline | Call `system-presence` once with a 5-second timeout; success resumes normal monitoring | Distinguish a silent event stream from a Gateway that cannot serve a core read RPC |
| Restart only an unavailable ClawX-owned process | A failed deadline probe requests the existing guarded `GatewayManager.restart()` path | Recover a genuinely unresponsive local child process without adding a second restart implementation |
| Never automatically stop an external Gateway | A failed deadline probe replaces/reconnects only ClawX's WebSocket and records unavailable diagnostics | Prevent ClawX from issuing shutdown to a process it does not own |
| Keep authoritative lifecycle paths separate | Preserve existing WebSocket-close reconnect, code-1012 in-process reload recovery, process-exit recovery, and manual restart | Prevent duplicate or competing stop/start operations |
| Do not track active workloads in this change | Apply the same deadline regardless of chat, tool, or cron activity | Keep the first implementation focused on false restart prevention and process ownership |

---

### Task 1: Define The Three-Minute Liveness Deadline

**Files:**
- Create: `electron/gateway/recovery-controller.ts`
- Create: `electron/gateway/recovery-controller.test.ts`
- Modify: `electron/gateway/recovery-budget.ts`
- Modify: `electron/gateway/connection-monitor.ts`
- Test: `tests/unit/gateway-connection-monitor.test.ts`

**Interfaces:**
- Consumes: trusted-liveness notifications from `GatewayManager` and timing policy from `recovery-budget.ts`.
- Produces: serializable recovery state and callbacks requesting one deadline control-RPC probe, then either owned-process escalation or external transport reconnect.

- [ ] **Step 1: Write failing controller tests.** Cover deadline scheduling from `lastAliveAt`; any trusted signal resetting the 180-second timer; a deadline probe success returning to healthy; a deadline probe failure requesting exactly one owned-process escalation; an external Gateway failure requesting only transport reconnect; and old asynchronous callbacks being ignored after a newer liveness signal.
- [ ] **Step 2: Update connection-monitor tests.** Keep ping/pong metrics, but change the monitor contract so missed pongs are diagnostic only. It must notify the controller only when 180 seconds have elapsed without `markAlive`, never at a fourth-miss threshold. Verify pongs and arbitrary incoming messages reset the silence deadline.
- [ ] **Step 3: Implement policy constants.** Add named constants for the 180-second silence deadline and the 5-second `system-presence` deadline probe. Keep existing ping interval/timeout values unless focused measurements justify changing them. Recalculate `ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS` from the new bounded recovery path.
- [ ] **Step 4: Implement `GatewayRecoveryController`.** Keep its state minimal: `healthy`, `verifying`, `restart-pending`, `restart-executing`, and `external-unavailable`. It must hold one timer/probe per liveness generation, cancel all work on `recordAlive()`/stop, and never directly manipulate a process or WebSocket.
- [ ] **Step 5: Preserve diagnostic evidence.** Define a serializable snapshot with `lastAliveAt`, state, deadline time, last deadline-probe time/result/error, escalation reason, and whether the Gateway was externally managed. Do not record credentials, RPC payloads, or tokens.
- [ ] **Step 6: Run focused tests.** Run `pnpm test -- electron/gateway/recovery-controller.test.ts tests/unit/gateway-connection-monitor.test.ts`.
- [ ] **Step 7: Commit the task.** Commit only the policy/controller/tests after the focused tests pass.

### Task 2: Integrate Deadline Verification And Owned-Process Escalation

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
- Consumes: `GatewayRecoveryController` callbacks, WebSocket lifecycle callbacks, the existing `system-presence` RPC, and Gateway ownership state.
- Produces: deadline verification, owned-process-only automatic restart, external-Gateway transport reconnect, and extended `GatewayDiagnosticsSnapshot` data.

- [ ] **Step 1: Remove direct four-miss restart.** In `GatewayManager.startPing()`, report missed pongs only to diagnostics/liveness monitoring; remove the fourth-miss `this.restart()` callback. `consecutiveHeartbeatMisses` stays observable but cannot independently restart a process.
- [ ] **Step 2: Register all trusted liveness signals.** On successful handshake, pong, incoming Gateway frame, and successful RPC, update existing diagnostics and call `recoveryController.recordAlive()`. An unknown notification still counts as an incoming frame.
- [ ] **Step 3: Add the deadline probe.** Implement a private method that calls `rpc('system-presence', {}, GATEWAY_CONTROL_PROBE_TIMEOUT_MS)`. A success resets recovery. A failure is the only heartbeat-derived condition that can ask for automatic escalation, and only after the 180-second deadline.
- [ ] **Step 4: Gate escalation by ownership.** For an owned process with auto-recovery enabled and no restart already in flight, request guarded `restart()`. If the restart governor returns cooldown, retain the pending escalation and retry after `retryAfterMs`. For an external process, do not call `stop()` or `restart()`; terminate/recreate only the WebSocket through a guarded transport reconnect and expose `external-unavailable` diagnostics.
- [ ] **Step 5: Avoid races with existing lifecycle paths.** Explicit restart, stop, app quit, process exit, ordinary socket close, and code-1012 reload must cancel or supersede deadline callbacks. A code-1012 reconnection to an owned process records liveness and must not cause an extra restart.
- [ ] **Step 6: Extend diagnostics and health summary.** Add the recovery snapshot to `GatewayDiagnosticsSnapshot` and `buildGatewayHealthSummary`. A missed pong before deadline is degraded diagnostic evidence, not an `unresponsive` process state. A failed deadline probe must expose its reason without leaking response data.
- [ ] **Step 7: Update focused unit tests.** Replace four-miss direct-restart assertions with: pre-deadline misses never restart; liveness resets deadline; successful deadline probe never restarts; failed deadline probe restarts an owned Gateway exactly once; external Gateway never receives automatic stop/restart; code 1012 and process exit do not double-trigger recovery.
- [ ] **Step 8: Run focused tests.** Run `pnpm test -- tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/gateway-restart-governor.test.ts`.
- [ ] **Step 9: Commit the task.** Commit manager integration and all directly related unit tests.

### Task 3: Expose Recovery Diagnostics Without Adding A New Transport

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
- Produces: typed host diagnostics for deadline verification/escalation while retaining existing sidebar reconnect/restart states and manual restart control.

- [ ] **Step 1: Write failing service and renderer tests.** Assert `diagnostics.gatewaySnapshot()` includes a sanitized recovery object and Channels diagnostics distinguishes deadline verification, owned-process restart, and external-Gateway unavailability.
- [ ] **Step 2: Expose recovery through the existing host path.** Extend diagnostics result types and `host-api`; add recovery snapshot data in `diagnostics-api.ts`. Do not introduce renderer IPC or direct Gateway connections.
- [ ] **Step 3: Update Channels diagnostics minimally.** Reuse current diagnostics and Gateway status components. Add localized explanation only for recovery states requiring user interpretation; do not add a new automatic-restart control.
- [ ] **Step 4: Update E2E behavior.** Verify deadline verification and external unavailability are visible through existing diagnostics, owned recovery uses the existing restart lifecycle indicator, and manual restart remains functional.
- [ ] **Step 5: Run focused checks.** Run `pnpm test -- tests/unit/host-services.test.ts tests/unit/channels-page.test.tsx` and `pnpm run test:e2e -- tests/e2e/gateway-lifecycle.spec.ts tests/e2e/channels-health-diagnostics.spec.ts`.
- [ ] **Step 6: Commit the task.** Commit diagnostics contract/UI/locales and E2E coverage.

### Task 4: Update Harness Rules, Documentation, And Validate The Communication Change

**Files:**
- Create: `harness/specs/tasks/three-minute-gateway-liveness-recovery.md`
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
- Consumes: finalized deadline, ownership, diagnostics, and test behavior from Tasks 1-3.
- Produces: durable rules preventing a future return to pong-only automatic process restart.

- [ ] **Step 1: Add the task spec.** Reference `gateway-backend-communication`; require heartbeat safety, readiness, backend boundary, comms regression, E2E parallel isolation, and docs sync. Its acceptance criteria must cover 180-second deadline, 5-second `system-presence` verification, successful-probe cancellation, owned-process-only restart, external non-destructive recovery, and code-1012/process-exit preservation.
- [ ] **Step 2: Supersede the old four-miss task spec.** Mark `restore-gateway-heartbeat-recovery-after-four-misses.md` as historical/superseded without leaving contradictory acceptance criteria as current policy.
- [ ] **Step 3: Rewrite heartbeat safety.** State that missed pongs are diagnostic only; automatic owned-process restart requires the three-minute no-liveness deadline and failed core-RPC verification; external Gateways must never be shut down automatically.
- [ ] **Step 4: Update communication and startup-diagnostics scenarios.** Document trusted liveness evidence, the one deadline probe, ownership boundary, diagnostics fields, and unchanged renderer transport restrictions.
- [ ] **Step 5: Update README translations.** Describe the actual user behavior: ClawX waits three minutes without verified Gateway activity, verifies the core RPC, restarts only its own unavailable Gateway, and leaves external Gateways to manual recovery.
- [ ] **Step 6: Validate the harness.** Run `pnpm harness validate --spec harness/specs/tasks/three-minute-gateway-liveness-recovery.md`, then `pnpm harness run --spec harness/specs/tasks/three-minute-gateway-liveness-recovery.md`, and run `pnpm run harness:ci`.
- [ ] **Step 7: Run communication regression checks.** Run `pnpm run comms:replay` and `pnpm run comms:compare`; investigate and resolve any new Gateway restart/reconnect regression before proceeding.
- [ ] **Step 8: Run final project checks.** Run `pnpm test -- electron/gateway/recovery-controller.test.ts tests/unit/gateway-connection-monitor.test.ts tests/unit/gateway-manager-heartbeat.test.ts tests/unit/gateway-manager-diagnostics.test.ts tests/unit/gateway-manager-restart-recovery.test.ts tests/unit/gateway-restart-governor.test.ts tests/unit/host-services.test.ts tests/unit/channels-page.test.tsx tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts`, `pnpm run typecheck`, `pnpm run lint:check`, and `pnpm run test:e2e -- tests/e2e/gateway-lifecycle.spec.ts tests/e2e/channels-health-diagnostics.spec.ts`.
- [ ] **Step 9: Review the diff and commit the task.** Verify no generated files, unrelated changes, credentials, or renderer transport bypasses are included; then commit the harness/docs/validation changes.

## Verification Matrix

| Area | Required verification | Expected result |
| --- | --- | --- |
| Heartbeat monitor | `tests/unit/gateway-connection-monitor.test.ts` | Missed pongs are diagnostic; only 180 seconds without any trusted signal starts verification |
| Recovery controller | `electron/gateway/recovery-controller.test.ts` | One deadline probe per silence generation; liveness cancels stale work; ownership determines escalation |
| Gateway lifecycle | Gateway manager unit tests | Successful deadline probe does nothing; failure restarts only an owned process; external process is not stopped |
| Diagnostics | Host service and Channels unit tests | Recovery evidence is sanitized, typed, and visible through existing host APIs |
| User lifecycle | Gateway/Channels E2E | Existing restart/reconnect feedback remains correct and manual restart remains available |
| Communication regression | `pnpm run comms:replay` and `pnpm run comms:compare` | No unauthorized transport path or restart/reconnect regression |
| Harness and docs | Harness commands and README review | No lingering four-miss direct-restart rule remains |

# CLAWX External Gateway Safe Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a FastSafe, offline-only execution mode that attaches ClawX to an external LAH Gateway, disables config mutation and network-adjacent behaviors in safe mode, and keeps default behavior unchanged.

**Architecture:** Introduce a small runtime-flags helper for env-driven safe-mode decisions, then thread that into the gateway manager, ws client, config mutation helpers, telemetry, updater, provider validation, and external-link entry points. Keep the default path intact, but bypass spawn/kill/config-write logic when safe mode or external gateway mode is active.

**Tech Stack:** Electron, TypeScript, Vitest, zustand, ws.

---

### Task 1: Add runtime flags and isolated-path helpers

**Files:**
- Create: `electron/utils/runtime-flags.ts`
- Modify: `electron/utils/config.ts`
- Modify: `electron/utils/paths.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/utils/store.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/gateway.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert `LAH_SAFE_MODE=1` resolves safe-mode gates, `CLAWX_USER_DATA_DIR` is honored by the runtime path helper, and the settings contract exposes the new external-gateway fields.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/runtime-flags.test.ts tests/unit/paths.test.ts tests/unit/settings-store.test.ts`
Expected: FAIL because the helper and fields do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement env parsing, user-data resolution, and new settings defaults/contract fields without changing default runtime behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/runtime-flags.test.ts tests/unit/paths.test.ts tests/unit/settings-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/utils/runtime-flags.ts electron/utils/config.ts electron/utils/paths.ts electron/main/index.ts electron/utils/store.ts shared/host-api/contract.ts src/stores/settings.ts src/stores/gateway.ts tests/unit/runtime-flags.test.ts tests/unit/paths.test.ts tests/unit/settings-store.test.ts
git commit -m "feat: add LAH safe-mode runtime flags"
```

### Task 2: Make Gateway startup honor external mode

**Files:**
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/gateway/ws-client.ts`
- Modify: `electron/gateway/supervisor.ts`
- Modify: `electron/gateway/startup-orchestrator.ts`
- Modify: `electron/gateway/config-sync.ts`

- [ ] **Step 1: Write the failing tests**

Add tests covering external Gateway URL resolution, `/ws` not being appended in external mode, spawn bypass, and kill-on-conflict bypass.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/gateway-ws-client.test.ts tests/unit/gateway-startup-orchestrator.test.ts tests/unit/gateway-supervisor.test.ts tests/unit/gateway-external-mode.test.ts`
Expected: FAIL because external mode is not implemented yet.

- [ ] **Step 3: Write minimal implementation**

Add an external attach branch in the manager, pass exact ws URLs through the client, and bypass spawn/kill/config-sync paths when external mode is active.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/gateway-ws-client.test.ts tests/unit/gateway-startup-orchestrator.test.ts tests/unit/gateway-supervisor.test.ts tests/unit/gateway-external-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/gateway/manager.ts electron/gateway/ws-client.ts electron/gateway/supervisor.ts electron/gateway/startup-orchestrator.ts electron/gateway/config-sync.ts tests/unit/gateway-ws-client.test.ts tests/unit/gateway-startup-orchestrator.test.ts tests/unit/gateway-supervisor.test.ts tests/unit/gateway-external-mode.test.ts
git commit -m "feat: attach ClawX to external gateway in safe mode"
```

### Task 3: Gate config mutation, telemetry, updates, provider validation, and external links

**Files:**
- Modify: `electron/utils/openclaw-auth.ts`
- Modify: `electron/utils/telemetry.ts`
- Modify: `electron/main/updater.ts`
- Modify: `electron/services/updates-api.ts`
- Modify: `electron/services/providers/provider-validation.ts`
- Modify: `electron/services/providers-api.ts`
- Modify: `electron/utils/browser-oauth.ts`
- Modify: `electron/utils/device-oauth.ts`
- Modify: `electron/services/shell-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/main/menu.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Add offline tests that assert config writes are skipped in safe/external mode, telemetry init is skipped, updater checks do not hit the network, provider validation short-circuits, OAuth is blocked, and external URLs are guarded.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/openclaw-auth.test.ts tests/unit/telemetry.test.ts tests/unit/provider-validation.test.ts tests/unit/update-store.test.ts tests/unit/external-links.test.ts`
Expected: FAIL until the gates are implemented.

- [ ] **Step 3: Write minimal implementation**

Short-circuit the write helpers and the main process entry points so safe mode never mutates OpenClaw config, never launches OAuth/validation flows, and never performs update or telemetry network activity.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/openclaw-auth.test.ts tests/unit/telemetry.test.ts tests/unit/provider-validation.test.ts tests/unit/update-store.test.ts tests/unit/external-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/utils/openclaw-auth.ts electron/utils/telemetry.ts electron/main/updater.ts electron/services/updates-api.ts electron/services/providers/provider-validation.ts electron/services/providers-api.ts electron/utils/browser-oauth.ts electron/utils/device-oauth.ts electron/services/shell-api.ts electron/main/ipc-handlers.ts electron/main/menu.ts electron/main/index.ts tests/unit/openclaw-auth.test.ts tests/unit/telemetry.test.ts tests/unit/provider-validation.test.ts tests/unit/update-store.test.ts tests/unit/external-links.test.ts
git commit -m "feat: gate network-adjacent flows in LAH safe mode"
```

### Task 4: Add operator packet and verify offline checks

**Files:**
- Create: `docs/operator/CLAWX_PHASE1_ISOLATED_EXTERNAL_GATEWAY_OPERATOR_PACKET.md`

- [ ] **Step 1: Write the operator packet**

Document the env vars, isolated paths, forbidden commands, allowed offline commands, rollback steps, residual risks, and next BR recommendation.

- [ ] **Step 2: Run safe offline tests**

Run the smallest safe Vitest subset that covers the changed helpers and managers. Do not launch Electron, Gateway, or any install scripts.

- [ ] **Step 3: Commit**

```bash
git add docs/operator/CLAWX_PHASE1_ISOLATED_EXTERNAL_GATEWAY_OPERATOR_PACKET.md
git commit -m "docs: add CLAWX Phase 1 operator packet"
```

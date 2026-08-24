# Model-Aware Compaction Recovery Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set OpenClaw's compaction reserve to 25% of the selected model context window and defer ClawX Gateway recovery while an observed compaction is active.

**Architecture:** ClawX will resolve the selected model's configured context window inside the OpenClaw config mutation that updates a model selection and set the global reserve floor there. Startup sync applies the same correction for an existing default model. Gateway stderr compaction lifecycle markers feed a bounded activity tracker consulted by the recovery controller before it escalates a failed liveness probe. The developer settings panel reads the effective OpenClaw value through the existing host API boundary.

**Tech Stack:** Electron Main, React 19, TypeScript, Vitest, Playwright, OpenClaw JSON config.

## Global Constraints

- `agents.defaults.compaction.reserveTokensFloor` must be `Math.floor(contextWindow * 0.25)` for a known selected model.
- A previous floor in the local OpenClaw config must not prevent the ClawX-managed value from updating.
- Do not select a separate summarization model.
- Developer-only UI must use `react-i18next` with `en`, `zh`, `ja`, and `ru` locale coverage.
- Renderer access to OpenClaw config must use `hostApi`; direct Electron IPC and Gateway HTTP calls are prohibited.
- Compaction-aware recovery must remain bounded when OpenClaw never emits a completion signal.
- Update the heartbeat rule, task spec, three README files, and an Electron E2E spec.

---

### Task 1: Model-Aware Reserve Delivery

**Files:**
- Modify: `electron/utils/openclaw-auth.ts`
- Modify: `electron/utils/agent-config.ts`
- Test: `tests/unit/openclaw-auth.test.ts`

**Interfaces:**
- Consumes: selected `provider/model` reference and its `models.providers.*.models[].contextWindow` or `contextTokens` metadata.
- Produces: a corrected `agents.defaults.compaction.reserveTokensFloor` written atomically with startup sync and model changes.

- [x] **Step 1: Write failing tests** for startup replacement of an explicit stale floor, 25% rounding, and model-switch rewrites.
- [x] **Step 2: Run** `pnpm exec vitest run tests/unit/openclaw-auth.test.ts` and verify the old preservation behavior fails the new assertion.
- [x] **Step 3: Implement** one shared model-context resolver and 25% floor calculator, with a comment documenting parity with the OpenCode strategy.
- [x] **Step 4: Apply** the resolver during startup and inside the model-switch config transaction when the context window is known.
- [x] **Step 5: Re-run** the focused unit test.
- [ ] **Step 6: Commit** the task.

### Task 2: Compaction-Safe Gateway Recovery

**Files:**
- Create: `electron/gateway/compaction-activity.ts`
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/gateway/recovery-controller.ts`
- Modify: `electron/gateway/recovery-budget.ts`
- Modify: `harness/specs/rules/gateway-heartbeat-safety.md`
- Test: `electron/gateway/recovery-controller.test.ts`
- Test: `tests/unit/gateway-manager-heartbeat.test.ts`

**Interfaces:**
- Consumes: OpenClaw stderr `[compaction-diag] start` and `end` lifecycle markers.
- Produces: bounded recovery deferral while an observed compaction runs.

- [x] **Step 1: Write failing tests** for failed deadline probes being deferred during active compaction, resuming after end, and expiring a missing end marker.
- [x] **Step 2: Run** the recovery-controller and compaction-activity tests and verify the old direct-restart assertion fails.
- [x] **Step 3: Implement** a small stderr activity tracker with a bounded grace deadline, and pass its status to the recovery controller before owned-process escalation.
- [x] **Step 4: Update** the heartbeat harness rule to allow only this bounded observed-compaction exception.
- [x] **Step 5: Re-run** the focused tests.
- [ ] **Step 6: Commit** the task.

### Task 3: Developer Configuration Visibility

**Files:**
- Modify: `electron/services/openclaw-api.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `shared/i18n/locales/en/settings.json`
- Modify: `shared/i18n/locales/zh/settings.json`
- Modify: `shared/i18n/locales/ja/settings.json`
- Modify: `shared/i18n/locales/ru/settings.json`
- Test: `tests/e2e/developer-mode.spec.ts`

**Interfaces:**
- Consumes: Main-owned OpenClaw config read route.
- Produces: a developer-gated read-only display of the effective reserve floor and the 25% policy.

- [x] **Step 1: Write a failing E2E assertion** that the reserve setting is hidden before Developer Mode and visible after it is enabled.
- [x] **Step 2: Run** `pnpm exec playwright test tests/e2e/developer-mode.spec.ts --project=parallel --no-deps` and verify the selector is absent after Developer Mode is enabled.
- [x] **Step 3: Implement** the typed host route and developer UI using existing settings styles and locale keys.
- [x] **Step 4: Re-run** the E2E spec.
- [ ] **Step 5: Commit** the task.

### Task 4: Documentation and Validation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `harness/specs/tasks/model-aware-compaction-reserve-and-recovery.md`

- [x] **Step 1: Document** the automatic 25% reserve policy and developer visibility in all three README files.
- [ ] **Step 2: Validate** the task spec with `pnpm harness validate --spec harness/specs/tasks/model-aware-compaction-reserve-and-recovery.md` (blocked by unrelated branch diff outside this task's touched areas).
- [x] **Step 3: Run** focused tests, `pnpm run typecheck`, `pnpm run comms:replay`, and `pnpm run comms:compare`.
- [ ] **Step 4: Commit** the task.

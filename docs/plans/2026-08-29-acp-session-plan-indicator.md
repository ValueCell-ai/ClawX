# ACP Session Plan Indicator Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the latest valid OpenClaw `update_plan` task list as a read-only, collapsible indicator above the active chat session's composer.

**Architecture:** A pure ACP projection scans the active in-memory timeline from newest to oldest and normalizes the first valid non-failed `update_plan` input. The Chat page derives this value from `visibleAcpTimeline`, passes it to `ChatInput`, and a focused renderer component presents the progress pill and details. ACP replay remains the exclusive persistence mechanism; neither Renderer nor Main adds a plan cache.

**Tech Stack:** React 19, TypeScript, Zustand ACP timeline state, Tailwind design tokens, lucide-react, react-i18next, Vitest with Testing Library, Electron Playwright, and the repository Harness.

## Global Constraints

- `update_plan` is read-only in ClawX. Do not add plan mutation controls, IPC channels, Host API calls, Main-process storage, or Electron-store persistence.
- Derive plans only from `ToolCallItem.input`; do not parse tool titles, tool output, or assistant prose as plan data.
- A valid plan has a non-empty ordered `plan` array; every entry has a non-empty string `step` and exactly one recognized status: `pending`, `in_progress`, or `completed`; at most one entry is `in_progress`.
- Select the newest valid `update_plan` tool call that is not failed. A live valid update is visible, and a failed update falls back to the prior valid plan.
- Scope the projection to `visibleAcpTimeline`. Session switch, reload, and restart restore only what OpenClaw ACP replay supplies in `rawInput.plan`; no stale fallback is allowed.
- The pill is initially collapsed for each mounted session. Expansion is transient component state and resets on session replacement, reload, and restart.
- Route every new user-visible string through `react-i18next` with matching `en`, `zh`, `ja`, and `ru` `chat.json` coverage.
- Use existing semantic tokens: `bg-surface-modal`, `bg-surface-input`, `bg-black/5 dark:bg-white/10`, and paired `text-*-700 dark:text-*-400` status colors. Interactive controls require semantic button behavior, visible focus styling, an accessible name, and `aria-expanded`.
- The implementation must not alter Main-owned ACP transport, history replay, or session-routing behavior.

---

### Task 1: Record The ACP Projection Contract

**Files:**
- Create: `harness/specs/tasks/acp-session-plan-indicator.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`

**Interfaces:**
- Consumes: the approved design in `docs/specs/2026-08-29-acp-session-plan-design.md` and existing ACP timeline/replay ownership rules.
- Produces: a Harness task spec named `acp-session-plan-indicator` that names `acp-chat-experience`, requires `acp-chat-state-and-history` and `ui-i18n-design-tokens`, and identifies the projection and replay acceptance criteria.

- [ ] **Step 1: Create the task spec with front matter that lists the exact source, locale, unit-test, and E2E paths from Tasks 2-4.** Set `scenario: acp-chat-experience`, `taskType: ui-feature`, and `intent` to project the latest replayable `update_plan` into the composer without additional persistence.
- [ ] **Step 2: Add acceptance criteria requiring structured `ToolCallItem.input` validation, newest non-failed selection, failed-update fallback, session-scoped replay restoration, no persistence or new transport, collapsed-by-default read-only UI, four-locale strings, and Electron E2E coverage.** Set required profiles to `fast` and `e2e`; require `acp-chat-state-and-history`, `ui-i18n-design-tokens`, `renderer-main-boundary`, and `docs-sync`.
- [ ] **Step 3: Extend `acp-chat-experience` to identify the composer plan indicator as a Renderer-only projection of replayed structured `update_plan` tool inputs.** Add the new task spec and test paths to its ownership list.
- [ ] **Step 4: Extend `acp-chat-state-and-history` to prohibit a plan fallback from title/output/prose or persistent cache, and to require hiding the indicator when ACP replay omits valid structured plan input.** Preserve the existing ACP-authority rule language.
- [ ] **Step 5: Run `pnpm harness validate --spec harness/specs/tasks/acp-session-plan-indicator.md` and `pnpm harness run --spec harness/specs/tasks/acp-session-plan-indicator.md --dry-run`; both commands must select the declared scenario/rules without structural validation failures.**
- [ ] **Step 6: Commit the Harness contract and its validation output as `docs(harness): define ACP session plan projection`.**

### Task 2: Add A Pure Current-Plan Projection

**Files:**
- Create: `src/lib/acp/current-plan.ts`
- Create: `tests/unit/acp-current-plan.test.ts`

**Interfaces:**
- Consumes: `AcpTimelineSnapshot`, ordered `itemOrder`, and `ToolCallItem.input` from `src/lib/acp/timeline-types.ts`.
- Produces: `AcpCurrentPlanStep`, `AcpCurrentPlan`, and `getCurrentAcpPlan(snapshot: AcpTimelineSnapshot): AcpCurrentPlan | null` for renderer components.

- [ ] **Step 1: Write failing unit cases for a valid completed/pending/in-progress plan, completed/total count calculation, newest-plan precedence, a running plan, fallback after a newer failed update, and `null` for no plan.** Build snapshots with `tool-call` items whose `title` begins with `update_plan:` and whose `input` is structured data.
- [ ] **Step 2: Add failing invalid-input cases for missing input, empty plan arrays, non-object entries, blank steps, unknown statuses, and multiple in-progress steps.** Assert every invalid candidate is skipped and never selected.
- [ ] **Step 3: Run `pnpm exec vitest run tests/unit/acp-current-plan.test.ts` and confirm the new assertions fail because the projection module does not exist.**
- [ ] **Step 4: Implement `getCurrentAcpPlan` with local runtime guards only.** Recognize a plan call from the tool-name prefix before the first colon, scan `itemOrder` backward, ignore missing items and failed tool calls, normalize only `{ step, status }`, and return a plain result containing ordered steps, `completedCount`, and `totalCount`.
- [ ] **Step 5: Run `pnpm exec vitest run tests/unit/acp-current-plan.test.ts`; all projection and invalid-input cases must pass.**
- [ ] **Step 6: Commit the helper and its tests as `feat(chat): derive current ACP session plan`.**

### Task 3: Render The Read-Only Composer Plan Indicator

**Files:**
- Create: `src/pages/Chat/AcpSessionPlan.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Create: `tests/unit/acp-session-plan.test.tsx`
- Modify: `tests/unit/chat-input.test.tsx`
- Modify: `tests/unit/chat-acp-inline-timeline.test.tsx`

**Interfaces:**
- Consumes: `AcpCurrentPlan` from `src/lib/acp/current-plan.ts` and the existing `ChatInput` props.
- Produces: `AcpSessionPlan({ plan, sessionKey })` and an optional `currentPlan?: AcpCurrentPlan | null` `ChatInput` prop. `sessionKey` is the reset identity for expansion state.

- [ ] **Step 1: Write failing component tests for hidden output with `null`, collapsed initial output with `ListChecks` and localized `X / Y`, mouse and keyboard toggling, correct `aria-expanded`, all task statuses, source order, completed appearance, and wrapped task text.** Use `acp-session-plan-toggle`, `acp-session-plan-panel`, and `acp-session-plan-step` as stable test IDs.
- [ ] **Step 2: Write a failing rerender test showing that replacing `sessionKey` or replacing the current plan for a new session closes an expanded panel.** Confirm the component exposes no edit, delete, checkbox, or IPC-triggering controls.
- [ ] **Step 3: Implement `AcpSessionPlan` as a semantic button and bounded, layout-flow detail panel.** Use `ListChecks` for the toggle, `CheckCircle2` for completed steps, `Loader2` for the in-progress step, and `Circle` for pending steps. Apply existing modal, selected-state, focus, and status-color tokens; keep all text behind `useTranslation('chat')`.
- [ ] **Step 4: Add `acp.sessionPlan.progress`, `acp.sessionPlan.expand`, `acp.sessionPlan.collapse`, and `acp.sessionPlan.tasks` to all four `chat.json` files.** Reuse `acp.pending`, `acp.running`, and `acp.completed` for status text rather than duplicating them.
- [ ] **Step 5: In `Chat`, call `getCurrentAcpPlan(visibleAcpTimeline)` through the existing deferred timeline flow and pass it with `currentSessionKey` into `ChatInput`.** Keep the derivation session-scoped; do not subscribe to a second store or create an effect that caches the result.
- [ ] **Step 6: Extend `ChatInput` to render `AcpSessionPlan` before its existing working indicators, attachment previews, and composer box.** Preserve all existing input, attachment, workspace, target-agent, and send behavior when `currentPlan` is absent.
- [ ] **Step 7: Update the Chat-page mock in `chat-acp-inline-timeline.test.tsx` to capture the `currentPlan` prop.** Add an integration assertion that a timeline containing structured `update_plan` input reaches the composer and that a mismatched/empty visible session does not leak a plan.
- [ ] **Step 8: Run `pnpm exec vitest run tests/unit/acp-session-plan.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx`; all new UI, reset, prop-flow, and existing composer tests must pass.**
- [ ] **Step 9: Commit the renderer UI, integration, locales, and focused tests as `feat(chat): show current session plan above composer`.**

### Task 4: Prove ACP History Replay In Electron

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`

**Interfaces:**
- Consumes: the plan-pill test IDs from `AcpSessionPlan`, the existing Electron ACP mock installation helpers, and replayed `tool_call` events with `rawInput.plan`.
- Produces: live, session-switch, and renderer-reload evidence that the pill derives from ACP history without a ClawX cache.

- [ ] **Step 1: Add `installAcpLoadReplayBySessionMock(app, updatesBySessionKey)` beside `installAcpLoadReplayMock`.** It must read the requested `sessionKey` from the `chat.loadAcpSession` host request, return only `updatesBySessionKey[sessionKey]`, and wrap every replay update with that same session key and `historical: true`. Extend `installAcpChatMocks` to accept the session catalog used by the test sidebar. Emit `rawInput: { plan: [...] }` for every replayed `update_plan` event; do not simulate a separate plan store.
- [ ] **Step 2: Add a live-plan E2E test that emits a running `update_plan` with completed, in-progress, and pending steps.** Assert the composer pill shows the expected count, starts collapsed, expands after click, exposes all ordered step labels/statuses, and has no action controls other than its expansion button.
- [ ] **Step 3: Add a multi-session replay E2E test.** Load session A with a structured plan, switch to session B with a different plan or no plan, verify A's plan disappears, then return to A and verify only A's replayed plan is visible and collapsed.
- [ ] **Step 4: Add a renderer-reload E2E test using the same session-scoped replay fixture.** Open a plan-bearing session, expand it, reload the window so ACP history loads again, and assert the same replayed plan returns in collapsed state. This verifies recovery from replay rather than a retained component or renderer-memory state.
- [ ] **Step 5: Run `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "session plan|plan indicator"`; all new Electron scenarios must pass under the existing parallel policy.**
- [ ] **Step 6: Commit the replay tests and mock changes as `test(chat): cover ACP session plan replay`.**

### Task 5: Validate The Complete Feature And Documentation Scope

**Files:**
- Modify if behavior documentation requires it: `README.md`
- Modify if behavior documentation requires it: `README.zh-CN.md`
- Modify if behavior documentation requires it: `README.ja-JP.md`
- Modify if required by final Harness validation: `harness/specs/tasks/acp-session-plan-indicator.md`

**Interfaces:**
- Consumes: completed tasks, the approved design, and the Harness contract.
- Produces: a verified feature with documentation that accurately reflects any user-facing flow change in the repository's established README scope.

- [ ] **Step 1: Review the three README files against the completed user-facing behavior.** If they do not document ACP composer status surfaces, leave them unchanged and record that conclusion in the implementation PR/commit message rather than adding unrelated documentation.
- [ ] **Step 2: Run `pnpm harness validate --spec harness/specs/tasks/acp-session-plan-indicator.md` and `pnpm harness run --spec harness/specs/tasks/acp-session-plan-indicator.md`; both commands must pass against the real diff without `--no-diff`.**
- [ ] **Step 3: Run `pnpm exec vitest run tests/unit/acp-current-plan.test.ts tests/unit/acp-session-plan.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx tests/unit/acp-chat-components.test.tsx`.** Expect all focused and adjacent ACP/composer tests to pass.
- [ ] **Step 4: Run `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run build:vite`, and `pnpm run harness:ci`.** Expect no new lint, type, build, E2E, or Harness failures; diagnose and fix only regressions caused by this feature.
- [ ] **Step 5: Inspect `git status --short`, `git diff --check`, and the final diff to confirm no cache, generated output, secrets, or unrelated files are included.**
- [ ] **Step 6: Commit any required documentation or final validation fix as `docs: document ACP session plan indicator`.** Do not create an empty commit when no documentation or validation change is needed.

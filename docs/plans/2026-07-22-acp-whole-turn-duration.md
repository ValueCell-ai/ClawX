# ACP Whole-Turn Duration Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display one elapsed/final duration for live and historical ACP assistant turns without introducing a second Chat history authority.

**Architecture:** Renderer records live elapsed time against the optimistic ACP user message and preserves it in the existing memory-only live-session snapshot. For history, Electron Main reads a bounded OpenClaw transcript through a dedicated typed Host API and returns metadata-only turn timing candidates; the existing transcript supplement coordinator aligns those candidates to turns that ACP replay already created.

**Tech Stack:** Electron Main, TypeScript, React 19, Zustand, ACP SDK, react-i18next, Vitest, Playwright.

## Global Constraints

- ACP `session/load` remains authoritative for historical turn existence, content, and order.
- Renderer must use `hostApi.sessions.turnTimings`; it must not read transcript files directly.
- Transcript timing failure is best-effort and must never fail ACP session load or mutate timeline content.
- Historical reads remain bounded to the newest 1000 transcript message records and align duplicate user prompts from the tail.
- Live timing is client-observed whole-turn duration and includes model, tool, permission, transport, and queue time.
- All visible text is localized in English, Chinese, Japanese, and Russian and uses design tokens.
- OpenClaw source and distributed package behavior must not be modified.

---

### Task 1: Main Transcript Timing API

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `electron/services/sessions-api.ts`
- Test: `tests/unit/sessions-api-workspace.test.ts`

**Interfaces:**
- Consumes: OpenClaw transcript JSONL records resolved by session key.
- Produces: `SessionTurnTimingResult` containing bounded `SessionTurnTimingCandidate[]` values with normalized user text, duplicate occurrence from tail, and duration milliseconds.

- [ ] **Step 1: Write the failing test** for user-to-final-assistant timing across tools, duplicate prompts, inter-session continuation, invalid timestamps, and incomplete turns.
- [ ] **Step 2: Run the focused test and verify the expected failure** with `pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts`.
- [ ] **Step 3: Implement the minimum behavior** by preserving JSONL envelope timestamps in a timing-only parser and exposing `sessions.turnTimings` through the typed Host API. Add the required rationale comment that ACP `loadSession` omits timestamps needed for whole-turn duration.
- [ ] **Step 4: Run the focused and Host API regression tests** with `pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts`.
- [ ] **Step 5: Commit the task** with message `feat: extract ACP transcript turn timings`.

### Task 2: Historical Alignment And Live Store Timing

**Files:**
- Create: `src/lib/acp/turn-timings.ts`
- Modify: `src/lib/acp/openclaw-media-compat.ts`
- Modify: `src/lib/acp/transcript-supplement.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Test: `tests/unit/acp-turn-timings.test.ts`
- Test: `tests/unit/acp-chat-store.test.ts`

**Interfaces:**
- Consumes: `SessionTurnTimingCandidate[]`, `AcpTimelineSnapshot`, optimistic user message identity, and prompt settlement.
- Produces: `turnTimingsByUserMessageId: Record<string, AcpTurnTiming>` with running live and completed live/transcript variants.

- [ ] **Step 1: Write failing tests** for exact/duplicate-tail alignment, ambiguous rejection, live start/freeze/failure, stale supplement rejection, and navigation snapshot restoration.
- [ ] **Step 2: Run focused tests and verify expected failures** with `pnpm exec vitest run tests/unit/acp-turn-timings.test.ts tests/unit/acp-chat-store.test.ts`.
- [ ] **Step 3: Implement minimum alignment and store behavior**, reusing the existing normalized user-turn anchors and transcript supplement stale-operation guards.
- [ ] **Step 4: Run focused and existing transcript compatibility regressions** with `pnpm exec vitest run tests/unit/acp-turn-timings.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-media-attachments.test.ts tests/unit/acp-image-generation-compat.test.ts`.
- [ ] **Step 5: Commit the task** with message `feat: align ACP whole-turn timings`.

### Task 3: Assistant-Turn Duration Presentation

**Files:**
- Modify: `src/lib/acp/timeline-groups.ts`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/AcpTimeline.tsx`
- Modify: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-timeline-groups.test.ts`
- Test: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: assistant group user anchor and `AcpTurnTiming`.
- Produces: localized `acp-turn-duration` metadata beside the whole-turn copy action, ticking while running and frozen when complete.

- [ ] **Step 1: Write failing grouping and component tests** for preceding-user association, orphan turns, ticking live elapsed time, frozen historical duration, and tool-only turns.
- [ ] **Step 2: Run focused tests and verify expected failures** with `pnpm exec vitest run tests/unit/acp-timeline-groups.test.ts tests/unit/acp-chat-components.test.tsx`.
- [ ] **Step 3: Implement the minimum UI behavior** with locale-aware seconds formatting and established muted metadata tokens.
- [ ] **Step 4: Run focused tests and locale parity** with `pnpm exec vitest run tests/unit/acp-timeline-groups.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/i18n-locale-parity.test.ts`.
- [ ] **Step 5: Commit the task** with message `feat: display ACP whole-turn duration`.

### Task 4: Electron Flow And Durable Documentation

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/ui-i18n-design-tokens.md`
- Modify: `harness/reference/acp-chat.md`
- Modify: `harness/reference/acp-generated-media-and-diagnostics.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`

**Interfaces:**
- Consumes: completed implementation and typed fixture responses.
- Produces: Electron-level regression coverage and synchronized architecture documentation.

- [ ] **Step 1: Write the failing E2E scenario** proving live elapsed timing, navigation preservation, settlement freeze, and historical timing annotation on ACP replay.
- [ ] **Step 2: Run the focused E2E and verify the expected failure** with `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts --workers=1`.
- [ ] **Step 3: Complete fixture integration and documentation**, explicitly distinguishing metadata supplementation from the two content compatibility supplements.
- [ ] **Step 4: Run all task checks** listed in `harness/specs/tasks/acp-whole-turn-duration.md`, including comms replay/compare and harness validation.
- [ ] **Step 5: Commit the task** with message `test: cover ACP whole-turn duration`.

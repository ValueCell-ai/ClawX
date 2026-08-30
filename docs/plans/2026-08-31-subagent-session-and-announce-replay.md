# Subagent Session And Announcement Replay Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark native subagent conversations in the sidebar and deliver post-prompt main-agent announcements through ACP both live and on replay.

**Architecture:** Renderer classifies native subagents only from their canonical session key and applies display-only title cleanup. The pinned OpenClaw ACP adapter keeps one passive subscription for the loaded session, projects no-pending `announce:v1` Chat snapshots into recorded ACP updates, and supplements complete ledger replay only with timestamped transcript records beyond the ledger high-water mark.

**Tech Stack:** React 19, TypeScript, react-i18next, Electron Playwright, Vitest, OpenClaw ACP bridge patch, pnpm patched dependencies.

## Global Constraints

- Do not modify `/Users/zhuoxu/.openclaw` or `/Users/zhuoxu/workspace/openclaw`.
- ClawX Main and Renderer must not read ordinary transcript prose as a second Chat source.
- Preserve exact complete-ledger events and existing prompt/restart recovery behavior.
- Route every new display string through all four locales and use existing design tokens.
- Do not commit unless the user explicitly asks.

---

### Task 1: Sidebar Subagent Presentation

**Files:**
- Modify: `src/stores/chat/session-key-utils.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `shared/i18n/locales/{en,zh,ja,ru}/chat.json`
- Test: `tests/unit/session-key-utils.test.ts`
- Test: `tests/e2e/chat-sidebar-session-attention.spec.ts`

**Interfaces:**
- Consumes: canonical OpenClaw session keys and existing sidebar display titles.
- Produces: `isNativeSubagentSessionKey`, `formatSubagentSessionTitle`, and a localized `sidebar-session-subagent-*` tag.

- [ ] **Step 1: Write the failing key-classification, display-title, and Electron presentation tests.**
- [ ] **Step 2: Run the focused tests and verify missing helper/tag failures.**
- [ ] **Step 3: Implement exact-key classification, display-only prefix cleanup, localized Tag, and BotMessageSquare icon.**
- [ ] **Step 4: Run unit, locale parity, and Electron sidebar regressions.**
- [ ] **Step 5: Record the task as ready; do not commit without an explicit request.**

### Task 2: Live Ambient Announcement Projection

**Files:**
- Modify: `patches/openclaw@2026.7.1-2.patch`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/openclaw-acp-stream-patch.test.ts`

**Interfaces:**
- Consumes: loaded ACP session routing, Gateway `sessions.messages.subscribe`, and `chat` events with `announce:v1` run IDs.
- Produces: ordinary recorded ACP assistant chunks plus a terminal session-snapshot checkpoint.

- [ ] **Step 1: Write a failing bundle test for no-pending announce delta/final projection and passive subscription lifetime.**
- [ ] **Step 2: Run the bundle test and verify the ambient handler/subscription is absent.**
- [ ] **Step 3: Patch the pinned bundle with one active passive subscription and bounded per-run ambient snapshot state.**
- [ ] **Step 4: Refresh the patch hash, reinstall frozen dependencies, and rerun stream/restart tests.**
- [ ] **Step 5: Record the task as ready; do not commit without an explicit request.**

### Task 3: Complete-Ledger Transcript Tail

**Files:**
- Modify: `patches/openclaw@2026.7.1-2.patch`
- Modify: `pnpm-lock.yaml`
- Test: `tests/unit/openclaw-acp-stream-patch.test.ts`

**Interfaces:**
- Consumes: `AcpEventLedgerReplay.events[].at` and bounded `sessions.get` transcript message timestamps.
- Produces: an ordered ACP replay consisting of unchanged ledger events followed by strictly post-ledger transcript records.

- [ ] **Step 1: Write a failing bundle test for finite strict high-water selection and replay ordering.**
- [ ] **Step 2: Run the test and verify complete ledger currently suppresses all transcript reads.**
- [ ] **Step 3: Add bounded tail selection and replay after exact ledger events, with safe transcript-fetch fallback.**
- [ ] **Step 4: Verify the real field session in Electron and compare against OpenClaw WebUI.**
- [ ] **Step 5: Record the task as ready; do not commit without an explicit request.**

### Task 4: Architecture Documentation And Validation

**Files:**
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/sidebar-session-attention-authority.md`
- Modify: `harness/reference/acp-chat.md`
- Modify: `harness/reference/chat-workspace-and-navigation.md`
- Test: `harness/specs/tasks/surface-subagent-sessions-and-announcements.md`

**Interfaces:**
- Consumes: the completed UI and ACP contracts.
- Produces: durable authority, replay-boundary, UI classification, and validation documentation.

- [ ] **Step 1: Update scenario, rules, and references with the non-overlapping ledger/tail and subagent-display contracts.**
- [ ] **Step 2: Run `pnpm harness validate --spec harness/specs/tasks/surface-subagent-sessions-and-announcements.md`.**
- [ ] **Step 3: Run focused tests, typecheck, build, comms replay/compare, and the sidebar Electron spec.**
- [ ] **Step 4: Inspect `git diff --check`, final status, and test artifacts.**
- [ ] **Step 5: Record the work as complete; do not commit without an explicit request.**

# ACP Compaction Lifecycle Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show ordered historical and live OpenClaw context-compaction lifecycle markers in ClawX ACP Chat.

**Architecture:** Patched OpenClaw projects durable transcript compaction records and structured Gateway compaction lifecycle events into standard ACP `session_info_update` notifications with a versioned `openclaw.ai/compaction` metadata entry. ClawX validates that metadata, reduces each unique occurrence to a flat timeline item, and renders localized state without exposing the compaction summary. This compatibility envelope is temporary until the pinned ACP SDK accepts the draft native compaction update.

**Tech Stack:** TypeScript, React 19, react-i18next, ACP SDK 1.1.0, Vitest, Playwright Electron, pnpm patching, Harness specs.

## Global Constraints

- Use `_meta["openclaw.ai/compaction"]` on `session_info_update`; do not add an SDK-unknown `compaction_update` discriminator.
- Metadata version is exactly `1`; statuses are `in_progress`, `completed`, `failed`, and `cancelled`; sources are `threshold`, `overflow`, `preflight`, `manual`, and `transcript`.
- Every occurrence has a non-empty unique `compactionId`. Start and terminal events for one occurrence reuse it; a later occurrence uses a new ID even within the same run.
- A live successful end is `completed`; an aborted end is `cancelled`; an incomplete non-aborted end is `failed`. Preserve `willRetry` only as a boolean.
- Replay uses each transcript `type: "compaction"` entry's durable `id`, emits `completed` with source `transcript`, and preserves transcript order.
- Never render or forward the compaction summary. Do not infer state from stderr, usage changes, or assistant text.
- Renderer remains ACP-only and must not add direct Gateway or Electron IPC calls.
- Route all labels through the `chat` namespace for `en`, `zh`, `ja`, and `ru`, using design tokens from `src/styles/globals.css`.
- Do not execute tests or runtime commands in `/Users/zhuoxu/workspace/openclaw`; validate OpenClaw changes statically from ClawX.
- Run communication replay and comparison because this changes Gateway-to-ACP event projection.

---

### Task 1: Renderer Compaction Timeline Model

**Files:**
- Modify: `src/lib/acp/timeline-types.ts`
- Modify: `src/lib/acp/reducer.ts`
- Test: `tests/unit/acp-reducer.test.ts`

**Interfaces:**
- Consumes: `session_info_update._meta["openclaw.ai/compaction"]` with the version 1 compatibility contract.
- Produces: `CompactionItem`, `CompactionStatus`, and `CompactionSource` timeline types; item identity `compaction:${compactionId}`.

- [ ] **Step 1: Write the failing test**
  Add focused reducer tests proving that valid `in_progress` metadata inserts a compaction item after closing open message segments, a terminal update with the same ID patches that exact item without changing `itemOrder`, a second ID creates another ordered item even with the same `runId`, historical replay records `historical: true`, and malformed version/status/source/ID metadata is ignored by reference.
- [ ] **Step 2: Run the focused test and verify the expected failure**
  Run `pnpm exec vitest run tests/unit/acp-reducer.test.ts`. Expect failures because `TimelineItem` has no `compaction` kind and `session_info_update` only updates title metadata.
- [ ] **Step 3: Implement the minimum behavior**
  Define `CompactionStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled'`, `CompactionSource = 'threshold' | 'overflow' | 'preflight' | 'manual' | 'transcript'`, and `CompactionItem` with `kind`, `id`, `compactionId`, `status`, `source`, optional `runId`, `willRetry`, `timestamp`, and `historical`. Add a narrow record validator in `reducer.ts`; on valid metadata call `appendItem(closeAllMessageSegments(snapshot), item)` and preserve first-seen optional fields plus historical provenance when patching the same ID. Continue applying ordinary title and `updatedAt` metadata from the same update.
- [ ] **Step 4: Run the focused and relevant regression tests**
  Run `pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-timeline-groups.test.ts`. Expect all tests to pass and compaction items to remain ordinary assistant-side timeline items.
- [ ] **Step 5: Commit the task**
  Commit `feat(chat): reduce ACP compaction lifecycle updates` with only this task's files when commits are requested.

### Task 2: Localized Compaction Presentation

**Files:**
- Create: `src/pages/Chat/AcpCompactionStatus.tsx`
- Modify: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: `CompactionItem` from the reducer timeline.
- Produces: `AcpCompactionStatus` with `data-testid="acp-compaction-status"` and localized status text.

- [ ] **Step 1: Write the failing test**
  Add component tests for `in_progress`, successful `completed`, `completed` with `willRetry`, `failed`, and `cancelled`. Assert that no supplied or accidental summary field appears and multiple compaction items render separately in timeline order.
- [ ] **Step 2: Run the focused test and verify the expected failure**
  Run `pnpm exec vitest run tests/unit/acp-chat-components.test.tsx`. Expect failure because `AcpAssistantTurn` returns `null` for compaction items.
- [ ] **Step 3: Implement the minimum behavior**
  Render a compact full-width status row from `AcpAssistantTurn`. Use an animated, reduced-motion-safe indicator for `in_progress`, status-appropriate existing token colors for terminal states, and these semantic labels: compacting context; context compacted and continuing; compacted history; context compaction failed; context compaction cancelled. Add all five keys under `acp.compaction` in every locale.
- [ ] **Step 4: Run the focused and relevant regression tests**
  Run `pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/acp-timeline-groups.test.ts`. Expect all timeline rendering and grouping tests to pass.
- [ ] **Step 5: Commit the task**
  Commit `feat(chat): render compaction lifecycle status` with only this task's files when commits are requested.

### Task 3: OpenClaw ACP Compaction Projection

**Files:**
- Modify in patch source: `src/acp/translator.ts`
- Modify in patch source: `src/acp/translator.replay.ts`
- Modify in patch source: `src/agents/embedded-agent-subscribe.handlers.compaction.ts`
- Modify in patch source: `src/agents/embedded-agent-runner/run.ts`
- Modify in patch source: `src/gateway/server-methods/sessions.ts`
- Modify: `patches/openclaw@2026.7.1-2.patch`
- Modify: `pnpm-lock.yaml`
- Create: `tests/unit/openclaw-acp-compaction-patch.test.ts`

**Interfaces:**
- Consumes: Gateway `agent` events with `stream: "compaction"` and transcript `type: "compaction"` entries.
- Produces: version 1 `openclaw.ai/compaction` metadata through ACP `session_info_update` notifications.

- [ ] **Step 1: Write the failing test**
  Add a ClawX static patch-contract test that reads `patches/openclaw@2026.7.1-2.patch` and proves the patch contains: the namespaced metadata key, a unique compaction ID generated at occurrence start, terminal status mapping, ACP handling of compaction agent events, transcript compaction replay, and structured lifecycle emission around direct context-engine and manual session operations.
- [ ] **Step 2: Run the focused test and verify the expected failure**
  Run `pnpm exec vitest run tests/unit/openclaw-acp-compaction-patch.test.ts`. Expect failure because the current patch does not project compaction into ACP.
- [ ] **Step 3: Implement the minimum behavior**
  In the OpenClaw patch source, add `compactionId`, normalized source, and timestamp to structured start/end Gateway events. Store the active occurrence ID per run or operation so end reuses start and the next start generates another ID. Wrap direct preflight/timeout/overflow `contextEngine.compact()` and manual `session.operation` compaction with the same structured lifecycle and terminal mapping. Extend ACP `handleAgentEvent()` to emit and record `session_info_update` metadata for the matching pending prompt. Extend transcript replay extraction to return either text chunks or completed compaction metadata keyed by the transcript entry ID, preserving source order and excluding the summary. Regenerate the pnpm patch and lockfile patch hash without executing OpenClaw tests.
- [ ] **Step 4: Run the focused and relevant regression tests**
  Run `pnpm exec vitest run tests/unit/openclaw-acp-compaction-patch.test.ts tests/unit/acp-chat-service.test.ts` and `pnpm run typecheck`. Expect static patch assertions, ACP service regressions, and ClawX typing to pass. Do not run commands under `/Users/zhuoxu/workspace/openclaw`.
- [ ] **Step 5: Commit the task**
  Commit `feat(acp): project OpenClaw compaction lifecycle` with only this task's files when commits are requested.

### Task 4: Harness And Product Documentation

**Files:**
- Modify: `harness/specs/tasks/show-acp-compaction-lifecycle.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/reference/acp-chat.md`
- Modify: `docs/en-US/features.md`
- Modify: `docs/zh-CN/features.md`
- Modify: `docs/ja-JP/features.md`
- Modify: `docs/ru-RU/features.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`

**Interfaces:**
- Consumes: the implemented compatibility metadata and UI behavior.
- Produces: durable architecture, compatibility/removal condition, and user-facing feature documentation.

- [ ] **Step 1: Write the failing test**
  Run `pnpm harness validate --spec harness/specs/tasks/show-acp-compaction-lifecycle.md` before implementation documentation is complete and record any missing rule, path, or test coverage diagnostics.
- [ ] **Step 2: Run the focused test and verify the expected failure**
  Confirm validation identifies any unresolved touched areas or contract references; if structural validation already passes, use the existing absence of the compaction contract in `acp-chat-state-and-history.md` and `acp-chat.md` as the documented RED condition.
- [ ] **Step 3: Implement the minimum behavior**
  Replace the current rule statement that ACP has no compaction semantic event with the versioned compatibility extension and its native-RFD removal condition. Add compaction to the timeline model and history sections of `acp-chat.md`. Document visible historical/live compaction status in all feature docs and review all three root READMEs, updating only those whose feature overview describes ACP process-state presentation.
- [ ] **Step 4: Run the focused and relevant regression tests**
  Run `pnpm harness validate --spec harness/specs/tasks/show-acp-compaction-lifecycle.md` and `pnpm harness run --spec harness/specs/tasks/show-acp-compaction-lifecycle.md --dry-run`. Expect the spec and selected validation flow to pass.
- [ ] **Step 5: Commit the task**
  Commit `docs(acp): define compaction lifecycle contract` with only this task's files when commits are requested.

### Task 5: Electron End-To-End Coverage And Final Verification

**Files:**
- Modify: `tests/e2e/chat-acp-process-timeline.spec.ts`

**Interfaces:**
- Consumes: mocked routed ACP `session_info_update` notifications.
- Produces: Electron coverage for live in-place transition and multiple historical markers.

- [ ] **Step 1: Write the failing test**
  Add an E2E case that emits an `in_progress` compaction, verifies the localized running label, emits `completed` with the same ID and `willRetry: true`, verifies an in-place continuing label, then emits a separate completed transcript compaction ID and verifies both ordered markers remain visible.
- [ ] **Step 2: Run the focused test and verify the expected failure**
  Run `pnpm exec playwright test tests/e2e/chat-acp-process-timeline.spec.ts --grep "compaction"`. Expect failure before the renderer implementation is present.
- [ ] **Step 3: Implement the minimum behavior**
  Adjust only test fixtures or accessible selectors required to deliver realistic routed ACP metadata; do not bypass Main or mutate the Renderer store directly.
- [ ] **Step 4: Run the focused and relevant regression tests**
  Run `pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/openclaw-acp-compaction-patch.test.ts`, `pnpm run typecheck`, `pnpm run build:vite`, `pnpm run comms:replay`, `pnpm run comms:compare`, `pnpm exec playwright test tests/e2e/chat-acp-process-timeline.spec.ts --grep "compaction"`, and `pnpm run harness:ci`. Expect every command to pass; rerun lint once if the documented uv-download directory race occurs.
- [ ] **Step 5: Commit the task**
  Commit `test(chat): cover ACP compaction lifecycle` with only this task's files when commits are requested.

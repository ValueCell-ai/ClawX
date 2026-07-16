# ACP MEDIA Attached Turn Alignment Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover assistant `MEDIA:` attachments when the triggering ACP user turn contains images or resource links.

**Architecture:** ACP replay remains the primary timeline. ClawX records a lightweight, ordered projection of each structured ACP user prompt and reconstructs the exact user text OpenClaw writes to its transcript before matching transcript turns. The bounded transcript supplement continues to recover only explicit assistant `MEDIA:` references.

**Tech Stack:** TypeScript, Zustand, ACP SDK, Vitest, Playwright, harness specs

## Global Constraints

- Do not modify OpenClaw source or its distributed package.
- Do not modify Main-owned attachment authorization or transport policy.
- Do not strip arbitrary `[Resource link]` text or introduce fuzzy turn matching.
- Do not retain image base64 in the user-prompt alignment projection.
- Explain in code that transcript supplementation exists because OpenClaw ACP does not project assistant `MEDIA:` attachments.

---

### Task 1: Regression Contract

**Files:**
- Create: `harness/specs/tasks/fix-acp-media-attached-turn-alignment.md`
- Modify: `tests/unit/acp-media-attachments.test.ts`
- Modify: `tests/unit/acp-reducer.test.ts`
- Modify: `tests/unit/acp-chat-store.test.ts`

**Interfaces:**
- Consumes: Existing ACP timeline and transcript supplement behavior.
- Produces: Failing tests for structured attached-user turn alignment.

- [ ] **Step 1: Write the failing tests for text-plus-resource, image-only, resource-only, repeated, live, and historical turns.**
- [ ] **Step 2: Run `pnpm exec vitest run tests/unit/acp-media-attachments.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts` and verify alignment failures.**
- [ ] **Step 3: Validate the task spec with `pnpm harness validate --spec harness/specs/tasks/fix-acp-media-attached-turn-alignment.md`.**
- [ ] **Step 4: Commit the task if requested.**

### Task 2: Structured User Prompt Projection

**Files:**
- Modify: `src/lib/acp/timeline-types.ts`
- Modify: `src/lib/acp/content-blocks.ts`
- Modify: `src/lib/acp/reducer.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Test: `tests/unit/acp-reducer.test.ts`
- Test: `tests/unit/acp-chat-store.test.ts`

**Interfaces:**
- Consumes: ACP `ContentBlock` values and optimistic `AcpChatPromptPayload` media.
- Produces: Ordered, binary-free user prompt projection metadata on user message segments.

- [ ] **Step 1: Preserve text, embedded text, resource-link URI/title, and omitted binary block order.**
- [ ] **Step 2: Reconcile optimistic projections with echoed ACP user chunks.**
- [ ] **Step 3: Keep projection metadata internal and exclude image base64.**
- [ ] **Step 4: Run reducer and store tests.**
- [ ] **Step 5: Commit the task if requested.**

### Task 3: Exact OpenClaw Turn Alignment

**Files:**
- Create: `src/lib/acp/openclaw-prompt-compat.ts`
- Modify: `src/lib/acp/openclaw-media-compat.ts`
- Test: `tests/unit/acp-media-attachments.test.ts`
- Test: `tests/unit/acp-chat-store.test.ts`

**Interfaces:**
- Consumes: Ordered user prompt projections and raw transcript user messages.
- Produces: Exact OpenClaw-compatible user turn keys, including attachment-only empty keys.

- [ ] **Step 1: Reconstruct OpenClaw's text/resource/resource-link flattening without parsing user-authored marker text.**
- [ ] **Step 2: Add the required compatibility rationale comment.**
- [ ] **Step 3: Permit empty attachment-only anchors while retaining reverse occurrence, live identity, ambiguity, session, and generation guards.**
- [ ] **Step 4: Run focused compatibility and store tests.**
- [ ] **Step 5: Commit the task if requested.**

### Task 4: User-Visible And Durable Coverage

**Files:**
- Modify: `tests/e2e/chat-acp-attachments.spec.ts`
- Modify: `harness/reference/acp-generated-media-and-diagnostics.md`
- Modify: `harness/specs/rules/acp-chat-state-and-history.md`
- Modify: `harness/specs/rules/acp-compatibility-content-safety.md`
- Modify: `harness/specs/tasks/acp-media-attachments.md`

**Interfaces:**
- Consumes: Corrected live and historical projection behavior.
- Produces: Electron regression coverage and durable compatibility constraints.

- [ ] **Step 1: Add an E2E case with a structured user resource and assistant transcript `MEDIA:` output.**
- [ ] **Step 2: Verify the attachment renders once, raw `MEDIA:` stays hidden, and reload restores it.**
- [ ] **Step 3: Document exact structured anchor reconstruction and attachment-only alignment.**
- [ ] **Step 4: Run focused E2E and harness validation.**
- [ ] **Step 5: Commit the task if requested.**

### Task 5: Full Validation

**Files:**
- Test: Repository validation only

**Interfaces:**
- Consumes: Completed implementation and documentation.
- Produces: Verified build, communication replay, harness, and E2E results.

- [ ] **Step 1: Run focused unit tests, typecheck, lint, and Vite build.**
- [ ] **Step 2: Run `pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts`.**
- [ ] **Step 3: Run `pnpm run comms:replay` and `pnpm run comms:compare`.**
- [ ] **Step 4: Run task harness validation/run and `pnpm run harness:ci`.**
- [ ] **Step 5: Review the final diff and report results.**

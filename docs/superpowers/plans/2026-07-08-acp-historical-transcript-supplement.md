# ACP Historical Transcript Supplement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supplement historical ACP Chat image-generation completions from OpenClaw transcripts when ACP replay omits the async completion assistant message.

**Architecture:** Add a pure transcript extractor in `src/lib/acp/image-generation-compat.ts`, then call it from `src/stores/acp-chat-session.ts` after historical `loadSession` through `hostApi.sessions.history`. The extracted completions reuse the existing thumbnail hydration and synthetic ACP append path.

**Tech Stack:** React/Zustand renderer store, shared `RawMessage` transcript types, host-api session history, Vitest.

---

## Tasks

### Task 1: Pure Transcript Extractor

**Files:**
- Modify: `src/lib/acp/image-generation-compat.ts`
- Modify: `tests/unit/acp-image-generation-compat.test.ts`

- [ ] Write failing tests for transcript image-generation supplement extraction.
- [ ] Implement extraction of image-generation task starts plus later assistant `MEDIA:` candidates.
- [ ] Verify unrelated assistant `MEDIA:` text without prior `image_generate` start is rejected.

### Task 2: Store Integration

**Files:**
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `tests/unit/acp-chat-store.test.ts`

- [ ] Write failing store test where historical `loadSession` reads transcript history and appends the image preview.
- [ ] Add `hostApi.sessions.history` mocking to the store tests.
- [ ] Integrate transcript supplement after historical load success with a comment documenting the OpenClaw ACP limitation.
- [ ] Ensure fresh sessions do not read transcript history.

### Task 3: Validation

**Files:**
- Add: `harness/specs/tasks/acp-historical-transcript-supplement.md`

- [ ] Validate harness spec with `pnpm harness validate --spec harness/specs/tasks/acp-historical-transcript-supplement.md --since HEAD`.
- [ ] Run targeted unit tests: `pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-chat-store.test.ts`.
- [ ] Run `pnpm run typecheck` and `pnpm run build:vite`.
- [ ] Run `pnpm run comms:replay` and `pnpm run comms:compare` because this touches ACP/history communication paths.

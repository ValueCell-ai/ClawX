# Truncated ACP Title Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic sidebar titles that collapse to `…` after an OpenClaw cwd-envelope truncation with the actual first user prompt from the session summary.

**Architecture:** A shared helper recognizes only OpenClaw's exact truncated automatic title shape, `[Working directory: <cwd>]…`. The chat store treats that shape as no derived title, allowing existing summary hydration to populate the label. Explicit session labels and any other ellipsis-containing text remain unchanged.

**Tech Stack:** TypeScript, Zustand, Electron host API, Vitest.

---

## Commit Policy

Do not create commits unless the user explicitly requests one. Inspect the relevant diff after each task instead.

## File Structure

- Modify: `shared/chat/session-title.ts` to identify the exact upstream cwd-only truncation shape.
- Modify: `tests/unit/session-title.test.ts` to define the helper's boundary.
- Modify: `src/stores/chat.ts` so the invalid derived title cannot create a standalone ellipsis cache entry.
- Modify: `src/stores/chat/session-label-hydration.ts` so the invalid derived title does not suppress summary hydration.
- Modify: `tests/unit/chat-store-session-label-fetch.test.ts` with the reproduced `~/workspace/clawx-playground` session flow.

### Task 1: Define The Truncated Automatic-Title Boundary

**Files:**
- Modify: `shared/chat/session-title.ts`
- Modify: `tests/unit/session-title.test.ts`

- [ ] **Step 1: Write the failing helper contract**

Add these assertions to `tests/unit/session-title.test.ts`:

```ts
import {
  isAcpWorkingDirectoryTruncatedTitle,
  stripAcpWorkingDirectoryPrefix,
} from '@shared/chat/session-title'

it('identifies a cwd envelope truncated before the user prompt', () => {
  expect(
    isAcpWorkingDirectoryTruncatedTitle(
      '[Working directory: ~/workspace/clawx-playground]…',
    ),
  ).toBe(true)
})

it('does not treat an ellipsis after the normal cwd separator as truncation', () => {
  expect(
    isAcpWorkingDirectoryTruncatedTitle(
      '[Working directory: ~/workspace/clawx-playground]\n\n…',
    ),
  ).toBe(false)
  expect(isAcpWorkingDirectoryTruncatedTitle('…')).toBe(false)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts`

Expected: FAIL because `isAcpWorkingDirectoryTruncatedTitle` is not exported.

- [ ] **Step 3: Add the exact-shape helper**

Add to `shared/chat/session-title.ts`:

```ts
const ACP_WORKING_DIRECTORY_TRUNCATED_TITLE = /^\[Working directory: [^\r\n]*\]…$/

export function isAcpWorkingDirectoryTruncatedTitle(text: string): boolean {
  return ACP_WORKING_DIRECTORY_TRUNCATED_TITLE.test(text.trim())
}
```

Keep `stripAcpWorkingDirectoryPrefix` unchanged. The new pattern is anchored and requires the ellipsis immediately after the closing marker, which excludes a user prompt consisting of an ellipsis after the normal ACP separator.

- [ ] **Step 4: Run the focused test and inspect the diff**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts && git diff --check`

Expected: PASS; the helper accepts only the cwd-only truncation shape.

### Task 2: Recover The Real Session Summary Title

**Files:**
- Modify: `src/stores/chat.ts`
- Modify: `src/stores/chat/session-label-hydration.ts`
- Modify: `tests/unit/chat-store-session-label-fetch.test.ts`

- [ ] **Step 1: Write the failing reproduced-store regression**

Add a test in `tests/unit/chat-store-session-label-fetch.test.ts` that configures `sessions.list` with:

```ts
{
  key: 'agent:main:session-cwd-truncated',
  displayName: 'ACP',
  derivedTitle: '[Working directory: ~/workspace/clawx-playground]…',
  updatedAt: 1_783_791_638_956,
}
```

Seed the store with the same session key and `workspacePath: '/Users/zhuoxu/workspace/clawx-playground'`, so summary hydration is needed for the label rather than workspace discovery. Mock `/api/sessions/summaries` to return:

```ts
{
  success: true,
  summaries: [{
    sessionKey: 'agent:main:session-cwd-truncated',
    firstUserText: '当前目录有什么文件？解释。',
    lastTimestamp: 1_783_791_629_947,
    workspacePath: '/Users/zhuoxu/workspace/clawx-playground',
  }],
}
```

After `await useChatStore.getState().loadSessions()`, wait until the cache label is populated, then assert:

```ts
expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('当前目录有什么文件？解释。')
expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
  method: 'POST',
  body: JSON.stringify({ sessionKeys: [sessionKey, 'agent:main:main'] }),
})
```

- [ ] **Step 2: Run the regression and verify it fails**

Run: `pnpm exec vitest run tests/unit/chat-store-session-label-fetch.test.ts -t "cwd-only truncated derived title"`

Expected: FAIL because the current store caches `…` and treats the raw `derivedTitle` as sufficient to skip summary hydration.

- [ ] **Step 3: Prevent the invalid derived title from seeding the cache**

In `src/stores/chat.ts`, import `isAcpWorkingDirectoryTruncatedTitle` alongside `stripAcpWorkingDirectoryPrefix` and add this first line to `toAutomaticSessionLabel`:

```ts
if (isAcpWorkingDirectoryTruncatedTitle(text)) return ''
```

This leaves all explicit `session.label` formatting on `toSessionLabel`, untouched.

- [ ] **Step 4: Allow summary hydration when the derived title is invalid**

In `src/stores/chat/session-label-hydration.ts`, import `isAcpWorkingDirectoryTruncatedTitle` and replace the raw derived-title component of `backendLabel` with:

```ts
const explicitLabel = normalizeLabelValue(session.label)
const derivedTitle = isAcpWorkingDirectoryTruncatedTitle(session.derivedTitle || '')
  ? null
  : normalizeLabelValue(session.derivedTitle)
const backendLabel = explicitLabel ?? derivedTitle
```

Use this `backendLabel` for `needsLabel` and the existing backend-label early return. Do not change the hydration version; it can continue to reflect the raw Gateway data so a later upstream title update triggers a new hydration attempt.

- [ ] **Step 5: Run the regression and affected title tests**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts tests/unit/chat-store-session-label-fetch.test.ts`

Expected: PASS; the reproduced title becomes `当前目录有什么文件？解释。`, existing automatic-title cleanup and explicit-label tests remain green.

### Task 3: Verify The Runtime Boundary

**Files:**
- Review: `electron/services/acp-chat-service.ts`
- Review: `electron/services/sessions-api.ts`

- [ ] **Step 1: Confirm cwd injection is unchanged**

Run: `pnpm exec vitest run tests/unit/acp-chat-service.test.ts -t "creates fresh generated sessions|routes fresh-session prompts"`

Expected: PASS with `_meta.prefixCwd: true`; this fix changes title selection only.

- [ ] **Step 2: Confirm the Main summary remains the clean fallback**

Run: `pnpm exec vitest run tests/unit/host-services.test.ts -t "loads session summaries and transcript history"`

Expected: PASS; the summary strips the ACP transport envelope while transcript history retains the raw persisted message.

- [ ] **Step 3: Run static checks and inspect final changes**

Run: `pnpm run typecheck && pnpm run lint:check && git diff --check && git diff -- shared/chat/session-title.ts src/stores/chat.ts src/stores/chat/session-label-hydration.ts tests/unit/session-title.test.ts tests/unit/chat-store-session-label-fetch.test.ts`

Expected: type checking succeeds, lint has no errors, and the diff contains only the exact-title guard plus its tests.

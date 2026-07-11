# ACP Working Directory Title Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep OpenClaw ACP cwd prompt injection enabled while removing its transport prefix from automatically derived ClawX conversation titles.

**Architecture:** Add a shared pure normalizer that removes only a leading OpenClaw `[Working directory: ...]` line. Apply it exclusively at automatic title derivation boundaries: Main-process transcript summaries, Gateway `derivedTitle` consumption, and history fallback labels. Explicit OpenClaw session labels, including user renames, bypass the normalizer.

**Tech Stack:** TypeScript, Electron host API, Zustand, Vitest, Playwright, ClawX harness.

---

## Commit Policy

Do not create commits unless the user explicitly requests one. After every task, inspect the relevant diff instead of committing it.

## File Structure

- Create: `shared/chat/session-title.ts` for the protocol-specific, dependency-free title normalizer used by Main and renderer code.
- Create: `tests/unit/session-title.test.ts` for the normalizer contract.
- Modify: `electron/services/sessions-api.ts` to normalize transcript-derived `firstUserText` before returning it through the host API.
- Modify: `src/stores/chat.ts` to normalize only `derivedTitle`, session-summary, and history-derived labels while preserving `label` values.
- Modify: `tests/unit/host-services.test.ts`, `tests/unit/chat-store-session-label-fetch.test.ts`, and `tests/unit/chat-store-history-retry.test.ts` to cover each title source and manual-label preservation.
- Modify: `tests/e2e/chat-workspace-context.spec.ts` to cover the sidebar behavior through the Electron UI.
- Modify: `harness/specs/tasks/chat-workspace-context.md` to make the ACP cwd/title invariant explicit.
- Review only: `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for any documented title behavior.

### Task 1: Define The Shared ACP Title Normalizer

**Files:**
- Create: `shared/chat/session-title.ts`
- Create: `tests/unit/session-title.test.ts`

- [ ] **Step 1: Write the failing normalizer contract**

Create `tests/unit/session-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stripAcpWorkingDirectoryPrefix } from '@shared/chat/session-title';

describe('stripAcpWorkingDirectoryPrefix', () => {
  it('removes the leading OpenClaw cwd envelope and blank separator', () => {
    expect(stripAcpWorkingDirectoryPrefix(
      '[Working directory: ~/.openclaw/workspace]\n\nExplain this repository',
    )).toBe('Explain this repository');
  });

  it('supports Windows paths and CRLF transcript text', () => {
    expect(stripAcpWorkingDirectoryPrefix(
      '[Working directory: C:\\Users\\alex\\workspace\\ClawX]\r\n\r\nFix the test',
    )).toBe('Fix the test');
  });

  it('preserves ordinary messages and non-leading markers', () => {
    expect(stripAcpWorkingDirectoryPrefix('Explain this repository')).toBe('Explain this repository');
    expect(stripAcpWorkingDirectoryPrefix(
      'Question\n[Working directory: ~/.openclaw/workspace]',
    )).toBe('Question\n[Working directory: ~/.openclaw/workspace]');
  });
});
```

- [ ] **Step 2: Run the unit test and verify it fails**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts`

Expected: FAIL because `@shared/chat/session-title` does not exist.

- [ ] **Step 3: Implement the minimal shared helper**

Create `shared/chat/session-title.ts`:

```ts
const ACP_WORKING_DIRECTORY_PREFIX = /^\[Working directory: [^\r\n]*\](?:\r?\n\s*)?/;

/** Removes OpenClaw's persisted ACP cwd envelope from automatic title candidates. */
export function stripAcpWorkingDirectoryPrefix(text: string): string {
  return text.replace(ACP_WORKING_DIRECTORY_PREFIX, '');
}
```

The matcher is deliberately anchored so a user message that mentions the marker later remains unchanged.

- [ ] **Step 4: Run the normalizer unit test and inspect the diff**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts && git diff --check && git diff -- shared/chat/session-title.ts tests/unit/session-title.test.ts`

Expected: PASS; the diff contains only the helper and its tests.

### Task 2: Normalize Main-Process Transcript Summaries

**Files:**
- Modify: `electron/services/sessions-api.ts`
- Modify: `tests/unit/host-services.test.ts`

- [ ] **Step 1: Make the existing typed sessions-service test reproduce the prefix**

In `tests/unit/host-services.test.ts`, change the first transcript user message in `loads session summaries and transcript history through the typed sessions service` to:

```ts
content: '[Working directory: ~/.openclaw/workspace]\n\nHello from transcript',
```

Keep the history assertion unchanged except for the raw persisted content, and change the summary expectation to:

```ts
firstUserText: 'Hello from transcript',
```

This proves the host summary removes the envelope without rewriting transcript history.

- [ ] **Step 2: Run the focused host-service test and verify it fails**

Run: `pnpm exec vitest run tests/unit/host-services.test.ts -t "loads session summaries and transcript history"`

Expected: FAIL because `firstUserText` still begins with `[Working directory: ~/.openclaw/workspace]`.

- [ ] **Step 3: Normalize only the summary text**

In `electron/services/sessions-api.ts`, import the shared helper:

```ts
import { stripAcpWorkingDirectoryPrefix } from '@shared/chat/session-title';
```

At the end of `cleanSummaryUserText`, apply it after existing Sender, media, and timestamp cleanup:

```ts
function cleanSummaryUserText(text: string): string {
  const cleaned = text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
  return stripAcpWorkingDirectoryPrefix(cleaned).trim();
}
```

Do not apply the helper in `history`; callers of that route need the unmodified persisted message.

- [ ] **Step 4: Run focused Main-process coverage and inspect the diff**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts tests/unit/host-services.test.ts -t "stripAcpWorkingDirectoryPrefix|loads session summaries and transcript history" && git diff --check && git diff -- electron/services/sessions-api.ts tests/unit/host-services.test.ts`

Expected: PASS; the summary is clean while `sessionsApi.history` still returns the raw prefix.

### Task 3: Normalize Renderer Automatic Titles Without Touching Manual Labels

**Files:**
- Modify: `src/stores/chat.ts`
- Modify: `tests/unit/chat-store-session-label-fetch.test.ts`
- Modify: `tests/unit/chat-store-history-retry.test.ts`
- Modify: `tests/e2e/chat-workspace-context.spec.ts`

- [ ] **Step 1: Add failing coverage for Gateway-derived and host-summary titles**

Add this test to `tests/unit/chat-store-session-label-fetch.test.ts`:

```ts
it('normalizes automatic titles but preserves explicit session labels', async () => {
  gatewayRpcMock.mockResolvedValue({
    sessions: [
      {
        key: 'agent:main:session-derived',
        derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nDerived prompt',
        updatedAt: 1000,
      },
      {
        key: 'agent:main:session-renamed',
        label: '[Working directory: /user-chosen] Keep this title',
        derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nIgnored derived title',
        updatedAt: 1001,
      },
    ],
  });
  hostApiFetchMock.mockResolvedValue({
    success: true,
    summaries: [{
      sessionKey: 'agent:main:session-derived',
      firstUserText: '[Working directory: ~/.openclaw/workspace]\n\nSummary prompt',
      lastTimestamp: 1_700_000_000_000,
    }],
  });

  const { useChatStore } = await import('@/stores/chat');
  useChatStore.setState({
    currentSessionKey: 'agent:main:session-derived',
    currentAgentId: 'main',
    sessions: [],
    messages: [],
    sessionLabels: {},
    sessionLastActivity: {},
  });

  await useChatStore.getState().loadSessions();
  await Promise.resolve();
  await Promise.resolve();

  expect(useChatStore.getState().sessionLabels).toMatchObject({
    'agent:main:session-derived': 'Derived prompt',
    'agent:main:session-renamed': '[Working directory: /user-chosen] Keep this title',
  });
});
```

Add this test to `tests/unit/chat-store-history-retry.test.ts`:

```ts
it('uses a clean automatic title when history is the first available title source', async () => {
  const { useChatStore } = await import('@/stores/chat');
  useChatStore.setState({
    currentSessionKey: 'agent:main:session-history',
    currentAgentId: 'main',
    sessions: [{ key: 'agent:main:session-history' }],
    messages: [],
    sessionLabels: {},
    sessionLastActivity: {},
    sending: false,
    activeRunId: null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    error: null,
    loading: false,
    thinkingLevel: null,
  });
  gatewayRpcMock.mockImplementation(async (method: string) => {
    if (method === 'chat.history') {
      return {
        messages: [{
          role: 'user',
          content: '[Working directory: ~/.openclaw/workspace]\n\nHistory prompt',
          timestamp: 1000,
        }],
      };
    }
    return {};
  });

  await useChatStore.getState().loadHistory(false);

  expect(useChatStore.getState().sessionLabels['agent:main:session-history']).toBe('History prompt');
});
```

- [ ] **Step 2: Add the failing Electron sidebar regression**

At the top of `tests/e2e/chat-workspace-context.spec.ts`, add:

```ts
const AUTO_TITLE_WITH_CWD = `[Working directory: ${DEFAULT_WORKSPACE}]\n\nWorkspace chat`;
```

Update `installWorkspaceMocks` so the mocked session summary contains:

```ts
firstUserText: AUTO_TITLE_WITH_CWD,
```

and its `sessions.list` rows contain:

```ts
derivedTitle: AUTO_TITLE_WITH_CWD,
```

In `bound session shows read-only workspace and workspace tree uses the same cwd`, add assertions after locating `workspaceGroup`:

```ts
await expect(workspaceGroup).toContainText('Workspace chat');
await expect(workspaceGroup).not.toContainText('[Working directory:');
```

- [ ] **Step 3: Run the renderer title tests and E2E specification to verify they fail**

Run: `pnpm exec vitest run tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts -t "normalizes automatic titles|uses a clean automatic title" && pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts`

Expected: FAIL because automatic labels and the sidebar include the working-directory envelope.

- [ ] **Step 4: Split explicit and automatic title derivation in the active store**

In `src/stores/chat.ts`, import the shared helper near the existing shared imports:

```ts
import { stripAcpWorkingDirectoryPrefix } from '@shared/chat/session-title';
```

Keep `toSessionLabel` as the generic truncation helper. Add an automatic-source wrapper after it:

```ts
function toAutomaticSessionLabel(text: string, maxLength = 50): string {
  return toSessionLabel(stripAcpWorkingDirectoryPrefix(text), maxLength);
}
```

Change `getSessionBackendLabel` so explicit labels are never normalized and `derivedTitle` is:

```ts
function getSessionBackendLabel(session: ChatSession): string {
  const explicitLabel = toSessionLabel(session.label || '');
  return explicitLabel || toAutomaticSessionLabel(session.derivedTitle || '');
}
```

Use `toAutomaticSessionLabel` at all persisted automatic-title call sites:

```ts
const labelText = toAutomaticSessionLabel(summary.firstUserText || '');
```

```ts
const labelText = toAutomaticSessionLabel(summary?.firstUserText || '');
```

```ts
const labelText = toAutomaticSessionLabel(getMessageText(firstUserMsg.content));
```

Leave the optimistic-send title path as `toSessionLabel(trimmed)`: it is the user-entered raw prompt and must not reinterpret user content as an ACP envelope.

- [ ] **Step 5: Run the renderer title tests and E2E specification, then inspect the diff**

Run: `pnpm exec vitest run tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts -t "normalizes automatic titles|uses a clean automatic title" && pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts && git diff --check && git diff -- src/stores/chat.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts tests/e2e/chat-workspace-context.spec.ts`

Expected: PASS; `derivedTitle`, summary, and history fallback labels are clean, while the manual label remains unchanged.

### Task 4: Record The Harness Invariant

**Files:**
- Modify: `harness/specs/tasks/chat-workspace-context.md`

- [ ] **Step 1: Extend the existing workspace task spec**

In `harness/specs/tasks/chat-workspace-context.md`:

- Add `shared/chat/session-title.ts`, `tests/unit/session-title.test.ts`, `tests/unit/host-services.test.ts`, `tests/unit/chat-store-session-label-fetch.test.ts`, and `tests/unit/chat-store-history-retry.test.ts` to `touchedAreas`.
- Add this `expectedUserBehavior` entry:

```yaml
- OpenClaw ACP cwd injection remains enabled, while automatic conversation titles omit its leading working-directory envelope.
```

- Add this acceptance entry:

```yaml
- Explicit user session labels remain unchanged even when they begin with a working-directory-looking string.
```

- [ ] **Step 2: Validate the harness and inspect the task-spec diff**

Run: `pnpm harness validate --spec harness/specs/tasks/chat-workspace-context.md && git diff --check && git diff -- harness/specs/tasks/chat-workspace-context.md`

Expected: harness validation passes and the task spec documents both title normalization and manual-label preservation.

### Task 5: Review Documentation And Run The Full Targeted Validation Set

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

- [ ] **Step 1: Review the three README files for automatic-title documentation**

Run: `rg -n -i "conversation title|session title|derived title|会话标题|会話タイトル" README.md README.zh-CN.md README.ja-JP.md`

Expected: no documented automatic-title behavior requiring an update. If a match describes title derivation, update the affected locale documents to say that ACP cwd envelopes are not displayed as automatic titles.

- [ ] **Step 2: Confirm ACP prompt injection stays explicitly enabled**

Run: `pnpm exec vitest run tests/unit/acp-chat-service.test.ts -t "creates fresh generated sessions|routes fresh-session prompts"`

Expected: PASS; each assertion continues to require `_meta: { sessionKey, prefixCwd: true }`.

- [ ] **Step 3: Run all affected unit tests and static validation**

Run: `pnpm exec vitest run tests/unit/session-title.test.ts tests/unit/host-services.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/acp-chat-service.test.ts && pnpm run typecheck && pnpm run lint:check`

Expected: all commands exit 0.

- [ ] **Step 4: Run the selected harness flow**

Run: `pnpm harness run --spec harness/specs/tasks/chat-workspace-context.md --dry-run`

Expected: the selected checks resolve successfully and report the updated task specification.

- [ ] **Step 5: Inspect the final diff without committing**

Run: `git diff --check && git status --short && git diff --stat && git diff -- shared/chat/session-title.ts electron/services/sessions-api.ts src/stores/chat.ts harness/specs/tasks/chat-workspace-context.md tests/unit/session-title.test.ts tests/unit/host-services.test.ts tests/unit/chat-store-session-label-fetch.test.ts tests/unit/chat-store-history-retry.test.ts tests/e2e/chat-workspace-context.spec.ts README.md README.zh-CN.md README.ja-JP.md`

Expected: no whitespace errors; only the planned normalization, tests, harness specification, design/plan documents, and any documentation update justified by the README review are present.

# Chat Workspace Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chat workspace selection and session-bound workspace context using OpenClaw ACP session `cwd` as the single source of truth.

**Architecture:** Persist only the global workspace selection in ClawX settings. Treat OpenClaw ACP session `cwd` as authoritative for bound sessions; ClawX reads it through the existing Main-owned host API and mirrors it in renderer state only for display/routing. Resolve one effective workspace in `Chat/index.tsx` and pass it to ACP load/send, the composer footer, the right workspace tree, and sidebar grouping.

**Tech Stack:** React 19, TypeScript, Zustand, Electron host-api, OpenClaw ACP metadata SQLite read, Vitest, Playwright, existing i18n files.

---

## Commit Policy

This environment forbids commits unless the user explicitly requests them. Do not commit while executing this plan unless the user asks for commits. At each checkpoint, inspect `git diff` and report changed files.

## File Structure

- Create: `shared/workspace.ts` for default workspace constants shared by Main and renderer.
- Create: `src/lib/workspace-context.ts` for pure renderer workspace resolution, display, and grouping helpers.
- Modify: `shared/chat/types.ts` to add `ChatSession.workspacePath` and allow `acknowledgeAcpSessionCreated(key, workspacePath)`.
- Modify: `shared/host-api/contract.ts` to add `chatWorkspacePath`, `recentWorkspacePaths`, and `SessionLabelSummary.workspacePath`.
- Modify: `electron/utils/store.ts` and `src/stores/settings.ts` to persist the global workspace and recent workspace list through host settings.
- Modify: `electron/services/sessions-api.ts` to read OpenClaw ACP `cwd` from `~/.openclaw/state/openclaw.sqlite` and return it in session summaries.
- Modify: `src/stores/chat.ts` to hydrate `ChatSession.workspacePath` from session summaries and to set local workspace after first ACP session creation.
- Modify: `src/pages/Chat/index.tsx` to resolve one effective workspace and use it for ACP load/send, footer display, and artifact panel props.
- Modify: `src/pages/Chat/ChatToolbar.tsx` so the workspace-panel button is enabled by the effective workspace, not only by `agent.workspace`.
- Modify: `src/pages/Chat/ChatInput.tsx` to render the compact footer workspace selector pill.
- Modify: `src/components/file-preview/ArtifactPanel.tsx` and `src/components/file-preview/WorkspaceBrowserBody.tsx` to accept a resolved workspace path instead of deriving only from `agent.workspace`.
- Modify: `src/components/layout/session-buckets.ts` and `src/components/layout/Sidebar.tsx` to group history by workspace first and recency buckets second.
- Modify: `shared/i18n/locales/en/chat.json`, `shared/i18n/locales/zh/chat.json`, `shared/i18n/locales/ja/chat.json`, and `shared/i18n/locales/ru/chat.json` for new visible strings.
- Create: `harness/specs/tasks/chat-workspace-context.md` because this touches renderer/Main/host-api/ACP communication paths.
- Create or modify unit tests under `tests/unit/` for workspace helpers, session summaries, chat page wiring, workspace browser props, and sidebar grouping.
- Create: `tests/e2e/chat-workspace-context.spec.ts` for the visible footer/right-panel/sidebar flow.
- Review: `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation; edit only if documented user flows changed.

### Task 1: Add Harness Task Spec

**Files:**
- Create: `harness/specs/tasks/chat-workspace-context.md`

- [ ] **Step 1: Write the harness task spec**

Create `harness/specs/tasks/chat-workspace-context.md` with:

```markdown
---
id: chat-workspace-context
title: Bind chat sessions to OpenClaw cwd workspace context
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add chat workspace selection while keeping OpenClaw ACP session cwd as the single source of truth for bound sessions.
touchedAreas:
  - harness/specs/tasks/chat-workspace-context.md
  - shared/workspace.ts
  - shared/chat/types.ts
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - electron/services/sessions-api.ts
  - src/lib/workspace-context.ts
  - src/lib/host-api.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/layout/session-buckets.ts
  - src/components/layout/Sidebar.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/session-buckets.test.ts
  - tests/e2e/chat-workspace-context.spec.ts
expectedUserBehavior:
  - New chat sessions use the globally selected workspace until their first send.
  - First send initializes the OpenClaw ACP session with the selected cwd.
  - Existing sessions use OpenClaw ACP cwd as their read-only workspace context.
  - Historical sessions with recoverable OpenClaw cwd group under their real cwd.
  - Sessions without recoverable cwd group under the default workspace label.
  - Renderer continues to use host-api and never calls direct IPC or Gateway HTTP.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/chat-workspace-context.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/workspace-context.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/session-buckets.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/workspace-browser-body.test.tsx
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - OpenClaw ACP cwd is the authoritative session workspace when available.
  - ClawX only persists global workspace selection and recent workspaces.
  - Bound session footer workspace is read-only.
  - Right workspace tree root matches effective chat workspace.
  - Sidebar groups sessions by workspace and then recency.
docs:
  required: review
---
```

- [ ] **Step 2: Validate the harness task spec**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/chat-workspace-context.md
```

Expected: PASS. If validation reports an unknown path because a later task has not created it yet, keep the spec and rerun this command after the referenced files exist.

### Task 2: Add Shared Workspace Constants And Pure Renderer Helpers

**Files:**
- Create: `shared/workspace.ts`
- Create: `src/lib/workspace-context.ts`
- Create: `tests/unit/workspace-context.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/workspace-context.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_CWD,
  formatWorkspacePath,
  getSessionWorkspaceForGrouping,
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
  resolveEffectiveWorkspace,
} from '@/lib/workspace-context';

describe('workspace context helpers', () => {
  it('recognizes default workspace spellings', () => {
    expect(DEFAULT_WORKSPACE_CWD).toBe('~/.openclaw/workspace');
    expect(isDefaultWorkspacePath('~/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('/Users/alex/.openclaw/workspace')).toBe(true);
    expect(isDefaultWorkspacePath('/Users/alex/workspace/ClawX')).toBe(false);
  });

  it('uses OpenClaw session cwd before global workspace', () => {
    expect(resolveEffectiveWorkspace({
      session: { workspacePath: '/repo/from-openclaw' },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: '/repo/from-openclaw', source: 'session', readOnly: true });
  });

  it('uses global workspace for unbound local sessions', () => {
    expect(resolveEffectiveWorkspace({
      session: { createdLocally: true },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: '/repo/global', source: 'global', readOnly: false });
  });

  it('falls back to default for sessions without recoverable cwd', () => {
    expect(resolveEffectiveWorkspace({
      session: { key: 'agent:main:session-old' },
      globalWorkspace: '/repo/global',
    })).toEqual({ cwd: DEFAULT_WORKSPACE_CWD, source: 'default', readOnly: true });
  });

  it('formats labels for default and non-default workspaces', () => {
    expect(getWorkspaceDisplayLabel('~/.openclaw/workspace', '默认工作空间')).toBe('默认工作空间');
    expect(getWorkspaceDisplayLabel('/Users/alex/workspace/ClawX', '默认工作空间')).toBe('~/workspace/ClawX');
    expect(formatWorkspacePath('/home/alex/project')).toBe('~/project');
  });

  it('groups sessions without cwd under default workspace', () => {
    expect(getSessionWorkspaceForGrouping({ key: 'agent:main:session-a' })).toBe(DEFAULT_WORKSPACE_CWD);
    expect(getSessionWorkspaceForGrouping({ key: 'agent:main:session-b', workspacePath: '/real/cwd' })).toBe('/real/cwd');
  });
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-context.test.ts
```

Expected: FAIL because `src/lib/workspace-context.ts` does not exist.

- [ ] **Step 3: Add shared constants**

Create `shared/workspace.ts` with:

```ts
export const DEFAULT_WORKSPACE_CWD = '~/.openclaw/workspace';
export const MAX_RECENT_WORKSPACES = 10;
```

- [ ] **Step 4: Add pure workspace helpers**

Create `src/lib/workspace-context.ts` with:

```ts
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';

export { DEFAULT_WORKSPACE_CWD };

export type WorkspaceResolutionSource = 'session' | 'global' | 'default';

export type WorkspaceResolution = {
  cwd: string;
  source: WorkspaceResolutionSource;
  readOnly: boolean;
};

type WorkspaceSessionLike = {
  key?: string;
  workspacePath?: string | null;
  createdLocally?: boolean;
};

export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (trimmed === '/') return '/';
  return trimmed.replace(/[\\/]+$/, '');
}

function slashPath(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isDefaultWorkspacePath(value: string | null | undefined): boolean {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return false;
  const slashed = slashPath(normalized);
  return slashed === DEFAULT_WORKSPACE_CWD
    || /^\/(?:Users|home)\/[^/]+\/\.openclaw\/workspace$/i.test(slashed)
    || /^[A-Za-z]:\/Users\/[^/]+\/\.openclaw\/workspace$/i.test(slashed);
}

export function formatWorkspacePath(workspace: string): string {
  const normalized = normalizeWorkspacePath(workspace) ?? '';
  if (!normalized) return '';

  const slashed = slashPath(normalized);
  const windowsHome = slashed.match(/^[A-Za-z]:\/Users\/[^/]+(?=\/|$)/i);
  if (windowsHome) return `~${slashed.slice(windowsHome[0].length) || ''}`;

  const posixHome = slashed.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/i);
  if (posixHome) return `~${slashed.slice(posixHome[0].length) || ''}`;

  return normalized;
}

export function getWorkspaceDisplayLabel(workspace: string | null | undefined, defaultLabel: string): string {
  const normalized = normalizeWorkspacePath(workspace) ?? DEFAULT_WORKSPACE_CWD;
  return isDefaultWorkspacePath(normalized) ? defaultLabel : formatWorkspacePath(normalized);
}

export function resolveEffectiveWorkspace(input: {
  session?: WorkspaceSessionLike | null;
  globalWorkspace?: string | null;
  defaultWorkspace?: string;
}): WorkspaceResolution {
  const defaultWorkspace = normalizeWorkspacePath(input.defaultWorkspace) ?? DEFAULT_WORKSPACE_CWD;
  const sessionWorkspace = normalizeWorkspacePath(input.session?.workspacePath);
  if (sessionWorkspace) {
    return { cwd: sessionWorkspace, source: 'session', readOnly: true };
  }

  const globalWorkspace = normalizeWorkspacePath(input.globalWorkspace);
  if (!input.session || input.session.createdLocally) {
    return {
      cwd: globalWorkspace ?? defaultWorkspace,
      source: globalWorkspace ? 'global' : 'default',
      readOnly: false,
    };
  }

  return { cwd: defaultWorkspace, source: 'default', readOnly: true };
}

export function getSessionWorkspaceForGrouping(session: WorkspaceSessionLike): string {
  return normalizeWorkspacePath(session.workspacePath) ?? DEFAULT_WORKSPACE_CWD;
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-context.test.ts
```

Expected: PASS.

### Task 3: Persist Global Workspace Settings

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/utils/store.ts`
- Modify: `src/stores/settings.ts`
- Modify: `tests/unit/host-services.test.ts`

- [ ] **Step 1: Write failing settings coverage**

Add this test inside the existing `describe('host services', ...)` or settings-related block in `tests/unit/host-services.test.ts` after existing settings tests:

```ts
  it('accepts chat workspace settings through the typed settings API', async () => {
    getAllSettingsMock.mockResolvedValue({
      theme: 'system',
      language: 'en',
      chatWorkspacePath: '~/.openclaw/workspace',
      recentWorkspacePaths: [],
    });
    setSettingMock.mockResolvedValue(undefined);

    const { createSettingsApi } = await import('@electron/services/settings-api');
    const api = createSettingsApi({
      getStatus: () => ({ state: 'stopped' }),
      restart: vi.fn(),
    } as never);

    await expect(api.set({ key: 'chatWorkspacePath', value: '/Users/alex/workspace/ClawX' })).resolves.toEqual({ success: true });
    await expect(api.set({ key: 'recentWorkspacePaths', value: ['/Users/alex/workspace/ClawX'] })).resolves.toEqual({ success: true });
    expect(setSettingMock).toHaveBeenCalledWith('chatWorkspacePath', '/Users/alex/workspace/ClawX');
    expect(setSettingMock).toHaveBeenCalledWith('recentWorkspacePaths', ['/Users/alex/workspace/ClawX']);
  });
```

- [ ] **Step 2: Run the focused settings test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/host-services.test.ts -t "accepts chat workspace settings"
```

Expected: FAIL with `Invalid settings key`.

- [ ] **Step 3: Extend host settings contract**

In `shared/host-api/contract.ts`, add these fields to `SettingsSnapshot`:

```ts
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
```

- [ ] **Step 4: Extend Electron store defaults**

In `electron/utils/store.ts`, import the shared constants:

```ts
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';
```

Add fields to `AppSettings`:

```ts
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
```

Add defaults in `createDefaultSettings()` under UI state:

```ts
    chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
    recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD],
```

- [ ] **Step 5: Extend renderer settings store**

In `src/stores/settings.ts`, import constants:

```ts
import { DEFAULT_WORKSPACE_CWD, MAX_RECENT_WORKSPACES } from '@shared/workspace';
```

Add state fields:

```ts
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
```

Add actions:

```ts
  setChatWorkspacePath: (workspacePath: string) => void;
```

Add defaults:

```ts
  chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
  recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD],
```

Add the action implementation before `resetSettings`:

```ts
      setChatWorkspacePath: (chatWorkspacePath) => {
        const normalized = chatWorkspacePath.trim() || DEFAULT_WORKSPACE_CWD;
        set((state) => {
          const recentWorkspacePaths = [
            normalized,
            ...state.recentWorkspacePaths.filter((entry) => entry !== normalized),
          ].slice(0, MAX_RECENT_WORKSPACES);
          void hostApi.settings.setMany({ chatWorkspacePath: normalized, recentWorkspacePaths }).catch(() => { });
          return { chatWorkspacePath: normalized, recentWorkspacePaths };
        });
      },
```

- [ ] **Step 6: Run the focused settings test**

Run:

```bash
pnpm exec vitest run tests/unit/host-services.test.ts -t "accepts chat workspace settings"
```

Expected: PASS.

### Task 4: Expose OpenClaw ACP Session Cwd Through Session Summaries

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/sessions-api.ts`
- Create: `tests/unit/sessions-api-workspace.test.ts`

- [ ] **Step 1: Write failing session summary tests**

Create `tests/unit/sessions-api-workspace.test.ts` with:

```ts
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testOpenClawDir = join(tmpdir(), `clawx-session-workspace-${process.pid}`);

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawDir,
}));

function seedAcpCwd(sessionKey: string, cwd: string) {
  const stateDir = join(testOpenClawDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(join(stateDir, 'openclaw.sqlite'));
  try {
    db.exec('CREATE TABLE acp_sessions (session_key TEXT PRIMARY KEY, cwd TEXT)');
    db.prepare('INSERT INTO acp_sessions (session_key, cwd) VALUES (?, ?)').run(sessionKey, cwd);
  } finally {
    db.close();
  }
}

describe('sessions API workspace summaries', () => {
  beforeEach(() => {
    rmSync(testOpenClawDir, { recursive: true, force: true });
  });

  it('returns OpenClaw ACP cwd as workspacePath when available', async () => {
    seedAcpCwd('agent:main:session-a', '/Users/alex/workspace/ClawX');
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-a'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-a',
      workspacePath: '/Users/alex/workspace/ClawX',
    });
  });

  it('returns null workspacePath when OpenClaw cwd is unavailable', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-missing'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-missing',
      workspacePath: null,
    });
  });
});
```

- [ ] **Step 2: Run the new session summary tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts
```

Expected: FAIL because `workspacePath` is not returned.

- [ ] **Step 3: Extend host API summary type**

In `shared/host-api/contract.ts`, add `workspacePath` to `SessionLabelSummary`:

```ts
export type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  workspacePath: string | null;
};
```

- [ ] **Step 4: Read OpenClaw ACP cwd from the state database**

In `electron/services/sessions-api.ts`, add imports:

```ts
import { access } from 'node:fs/promises';
```

Add `workspacePath` to `SessionSummary`:

```ts
type SessionSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  workspacePath: string | null;
};
```

Add this helper near `normalizeTimestamp`:

```ts
async function readOpenClawAcpSessionCwd(sessionKey: string): Promise<string | null> {
  const normalizedKey = sessionKey.trim();
  if (!normalizedKey) return null;
  const databasePath = join(getOpenClawConfigDir(), 'state', 'openclaw.sqlite');
  try {
    await access(databasePath);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db
        .prepare('SELECT cwd FROM acp_sessions WHERE session_key = ?')
        .get(normalizedKey) as { cwd?: unknown } | undefined;
      const cwd = typeof row?.cwd === 'string' ? row.cwd.trim() : '';
      return cwd || null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
```

Update `summarizeTranscriptMessages` to accept a workspace path:

```ts
function summarizeTranscriptMessages(sessionKey: string, messages: TranscriptMessage[], workspacePath: string | null): SessionSummary {
  let firstUserText: string | null = null;
  let lastTimestamp: number | null = null;

  for (const message of messages) {
    const normalizedTs = normalizeTimestamp(message.timestamp);
    if (normalizedTs != null) lastTimestamp = normalizedTs;
    if (firstUserText == null && message.role === 'user') {
      const text = cleanSummaryUserText(extractMessageText(message.content));
      if (text && !isInternalSummaryText(text)) firstUserText = text;
    }
  }

  return { sessionKey, firstUserText, lastTimestamp, workspacePath };
}
```

Update `loadSessionSummary` so every return includes `workspacePath`:

```ts
async function loadSessionSummary(sessionKey: string): Promise<SessionSummary> {
  const workspacePath = await readOpenClawAcpSessionCwd(sessionKey);
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
  }

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
    }

    const messages = await readAllTranscriptMessages(transcriptPath);
    return summarizeTranscriptMessages(sessionKey, messages, workspacePath);
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
  }
}
```

- [ ] **Step 5: Run the session summary tests**

Run:

```bash
pnpm exec vitest run tests/unit/sessions-api-workspace.test.ts
```

Expected: PASS.

### Task 5: Hydrate Chat Sessions With Workspace Paths

**Files:**
- Modify: `shared/chat/types.ts`
- Modify: `src/stores/chat.ts`
- Modify: `tests/unit/chat-load-sessions-startup.test.ts`

- [ ] **Step 1: Write failing chat store hydration test**

Add this test to `tests/unit/chat-load-sessions-startup.test.ts`:

```ts
  it('hydrates session workspacePath from host session summaries', async () => {
    const summariesMock = vi.mocked((await import('@/lib/host-api')).hostApi.sessions.summaries);
    summariesMock.mockResolvedValueOnce({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: null,
        lastTimestamp: null,
        workspacePath: '/Users/alex/workspace/ClawX',
      }],
    });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 }] };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();
    await Promise.resolve();

    expect(useChatStore.getState().sessions.find((session) => session.key === 'agent:main:session-a')?.workspacePath)
      .toBe('/Users/alex/workspace/ClawX');
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/chat-load-sessions-startup.test.ts -t "hydrates session workspacePath"
```

Expected: FAIL because `workspacePath` is not applied to `ChatSession`.

- [ ] **Step 3: Extend chat session types**

In `shared/chat/types.ts`, add this field to `ChatSession`:

```ts
  /** OpenClaw ACP session cwd, mirrored for display and routing. OpenClaw is the source of truth. */
  workspacePath?: string;
```

Change the action signature in `ChatState`:

```ts
  acknowledgeAcpSessionCreated: (key: string, workspacePath?: string) => void;
```

- [ ] **Step 4: Apply workspace paths from summaries**

In `src/stores/chat.ts`, update `applySessionLabelSummaries` so it also patches `sessions`:

```ts
function applySessionLabelSummaries(
  set: ChatSet,
  summaries: SessionLabelSummary[],
): void {
  if (summaries.length === 0) return;
  set((state) => {
    let nextLabels = state.sessionLabels;
    let nextActivity = state.sessionLastActivity;
    let nextSessions = state.sessions;
    let changed = false;

    for (const summary of summaries) {
      const labelText = toSessionLabel(summary.firstUserText || '');
      const existingLabel = nextLabels[summary.sessionKey]?.trim();
      if (labelText && !existingLabel) {
        if (nextLabels === state.sessionLabels) nextLabels = { ...state.sessionLabels };
        nextLabels[summary.sessionKey] = labelText;
        changed = true;
      }

      if (typeof summary.lastTimestamp === 'number' && Number.isFinite(summary.lastTimestamp)) {
        if (nextActivity[summary.sessionKey] !== summary.lastTimestamp) {
          if (nextActivity === state.sessionLastActivity) nextActivity = { ...state.sessionLastActivity };
          nextActivity[summary.sessionKey] = summary.lastTimestamp;
          changed = true;
        }
      }

      const workspacePath = typeof summary.workspacePath === 'string' && summary.workspacePath.trim()
        ? summary.workspacePath.trim()
        : null;
      if (workspacePath) {
        const sessionIndex = nextSessions.findIndex((session) => session.key === summary.sessionKey);
        if (sessionIndex >= 0 && nextSessions[sessionIndex].workspacePath !== workspacePath) {
          if (nextSessions === state.sessions) nextSessions = [...state.sessions];
          nextSessions[sessionIndex] = { ...nextSessions[sessionIndex], workspacePath };
          changed = true;
        }
      }
    }

    return changed
      ? { sessionLabels: nextLabels, sessionLastActivity: nextActivity, sessions: nextSessions }
      : {};
  });
}
```

Update `refreshVisibleSessionSummaries` target filtering so current sessions and main sessions can receive workspace metadata:

```ts
  const targetKeys = (sessionKeys && sessionKeys.length > 0
    ? sessionKeys
    : sessions.map((session) => session.key)
  ).filter((key) => key && key.startsWith('agent:'));
```

After `applySessionBackendLabels(set, sessionsWithCurrent);` inside `loadSessions`, add:

```ts
          void refreshVisibleSessionSummaries(
            set,
            get,
            sessionsWithCurrent.map((session) => session.key),
          );
```

Update `acknowledgeAcpSessionCreated`:

```ts
  acknowledgeAcpSessionCreated: (key: string, workspacePath?: string) => {
    const normalizedWorkspace = typeof workspacePath === 'string' && workspacePath.trim()
      ? workspacePath.trim()
      : undefined;
    set((s) => ({
      sessions: s.sessions.map((session) => (
        session.key === key && session.createdLocally
          ? { ...session, createdLocally: false, ...(normalizedWorkspace ? { workspacePath: normalizedWorkspace } : {}) }
          : session
      )),
    }));
  },
```

- [ ] **Step 5: Run the focused chat hydration test**

Run:

```bash
pnpm exec vitest run tests/unit/chat-load-sessions-startup.test.ts -t "hydrates session workspacePath"
```

Expected: PASS.

### Task 6: Resolve Effective Workspace In Chat Page

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatToolbar.tsx`
- Modify: `tests/unit/chat-acp-page.test.tsx`

- [ ] **Step 1: Write failing Chat page wiring tests**

In `tests/unit/chat-acp-page.test.tsx`, update the mocked `ChatInput` props type to accept workspace props:

```tsx
    workspaceLabel?: string;
    workspacePath?: string;
    workspaceReadOnly?: boolean;
    onSelectWorkspace?: (path: string) => void;
```

Render those props in the mock root:

```tsx
      <span data-testid="mock-workspace-label">{workspaceLabel}</span>
      <span data-testid="mock-workspace-path">{workspacePath}</span>
      <span data-testid="mock-workspace-readonly">{workspaceReadOnly ? 'readonly' : 'editable'}</span>
```

Add these tests:

```tsx
it('uses OpenClaw session workspacePath for ACP load and read-only footer', async () => {
  chatState.sessions = [{ key: 'agent:main:session-a', workspacePath: '/Users/alex/workspace/ClawX' }];
  chatState.currentSessionKey = 'agent:main:session-a';
  acpState.activeSessionKey = null;
  acpState.loadSession.mockResolvedValue(true);

  render(<Chat />);

  await waitFor(() => {
    expect(acpState.loadSession).toHaveBeenCalledWith({
      sessionKey: 'agent:main:session-a',
      cwd: '/Users/alex/workspace/ClawX',
    });
  });
  expect(screen.getByTestId('mock-workspace-path')).toHaveTextContent('/Users/alex/workspace/ClawX');
  expect(screen.getByTestId('mock-workspace-readonly')).toHaveTextContent('readonly');
});

it('does not create a local ACP session before first send', async () => {
  chatState.sessions = [{ key: 'agent:main:session-local', createdLocally: true }];
  chatState.currentSessionKey = 'agent:main:session-local';
  acpState.activeSessionKey = null;
  acpState.loadSession.mockResolvedValue(true);

  render(<Chat />);

  await Promise.resolve();
  expect(acpState.loadSession).not.toHaveBeenCalled();
  expect(screen.getByTestId('mock-workspace-readonly')).toHaveTextContent('editable');
});
```

- [ ] **Step 2: Run the focused Chat page tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/chat-acp-page.test.tsx -t "workspacePath|before first send"
```

Expected: FAIL because Chat still derives `cwd` from `currentAgent.workspace` and loads local sessions immediately.

- [ ] **Step 3: Wire effective workspace in `Chat/index.tsx`**

Add imports:

```ts
import { useSettingsStore } from '@/stores/settings';
import { getWorkspaceDisplayLabel, resolveEffectiveWorkspace } from '@/lib/workspace-context';
```

Add settings selectors after chat store selectors:

```ts
  const chatWorkspacePath = useSettingsStore((s) => s.chatWorkspacePath);
  const setChatWorkspacePath = useSettingsStore((s) => s.setChatWorkspacePath);
```

Replace the existing `cwd` derivation with:

```ts
  const currentSession = useMemo(
    () => sessions.find((session) => session.key === currentSessionKey) ?? null,
    [currentSessionKey, sessions],
  );
  const effectiveWorkspace = useMemo(
    () => resolveEffectiveWorkspace({ session: currentSession, globalWorkspace: chatWorkspacePath }),
    [chatWorkspacePath, currentSession],
  );
  const cwd = effectiveWorkspace.cwd;
  const workspaceLabel = getWorkspaceDisplayLabel(cwd, t('workspace.defaultLabel'));
```

In the ACP load effect, do not create local sessions before first send:

```ts
    const currentSession = sessions.find((session) => session.key === currentSessionKey);
    if (currentSession?.createdLocally) return;
    const createIfMissing = !currentSession;
```

In the send handler, after a successful `loadAcpSession` for a created session, call:

```ts
                  if (loaded && createIfMissing) {
                    acknowledgeAcpSessionCreated(sessionKey, promptCwd);
                  }
```

Pass workspace props to `ChatInput`:

```tsx
          workspaceLabel={workspaceLabel}
          workspacePath={cwd}
          workspaceReadOnly={effectiveWorkspace.readOnly}
          onSelectWorkspace={setChatWorkspacePath}
```

Pass workspace availability to `ChatToolbar`:

```tsx
            <ChatToolbar workspaceAvailable={!!cwd} />
```

In `src/pages/Chat/ChatToolbar.tsx`, extend `ChatToolbarProps`:

```ts
  workspaceAvailable?: boolean;
```

Update the function signature default:

```ts
  workspaceAvailable = false,
```

Update the workspace button so E2E can open the panel and so it is enabled by the effective workspace:

```tsx
              data-testid="chat-toolbar-workspace"
              onClick={() => (browserActive ? closePanel() : openBrowser())}
              disabled={!workspaceAvailable}
```

Pass workspace props to the artifact panel:

```tsx
                workspacePath={cwd}
                workspaceLabel={workspaceLabel}
```

- [ ] **Step 4: Run Chat page tests**

Run:

```bash
pnpm exec vitest run tests/unit/chat-acp-page.test.tsx
```

Expected: PASS.

### Task 7: Add The Compact Workspace Selector Pill

**Files:**
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `tests/unit/chat-input.test.tsx`
- Modify: locale files under `shared/i18n/locales/*/chat.json`

- [ ] **Step 1: Write failing ChatInput UI tests**

Add tests to `tests/unit/chat-input.test.tsx`:

```tsx
it('renders editable workspace selector in the composer footer', () => {
  render(
    <ChatInput
      onSend={vi.fn()}
      workspaceLabel="~/workspace/ClawX"
      workspacePath="/Users/alex/workspace/ClawX"
      workspaceReadOnly={false}
      onSelectWorkspace={vi.fn()}
    />,
  );

  const button = screen.getByTestId('chat-workspace-selector');
  expect(button).toHaveTextContent('~/workspace/ClawX');
  expect(button).toHaveAttribute('title', '/Users/alex/workspace/ClawX');
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

it('renders read-only workspace selector for bound sessions', () => {
  render(
    <ChatInput
      onSend={vi.fn()}
      workspaceLabel="默认工作空间"
      workspacePath="~/.openclaw/workspace"
      workspaceReadOnly
      onSelectWorkspace={vi.fn()}
    />,
  );

  const button = screen.getByTestId('chat-workspace-selector');
  expect(button).toHaveTextContent('默认工作空间');
  expect(button).toHaveAttribute('aria-disabled', 'true');
});
```

- [ ] **Step 2: Run focused ChatInput tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/chat-input.test.tsx -t "workspace selector"
```

Expected: FAIL because the selector is not rendered.

- [ ] **Step 3: Add ChatInput props**

In `src/pages/Chat/ChatInput.tsx`, extend `ChatInputProps`:

```ts
  workspaceLabel?: string;
  workspacePath?: string;
  workspaceReadOnly?: boolean;
  onSelectWorkspace?: (workspacePath: string) => void;
```

Update the component signature:

```ts
export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  sending = false,
  workspaceLabel,
  workspacePath,
  workspaceReadOnly = false,
  onSelectWorkspace,
}: ChatInputProps) {
```

- [ ] **Step 4: Add workspace picker handler**

Add this function near the other handlers in `ChatInput`:

```ts
  const handleSelectWorkspace = async () => {
    if (workspaceReadOnly || !onSelectWorkspace || inputDisabled || sending) return;
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        defaultPath: workspacePath,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) onSelectWorkspace(selected);
    } catch (error) {
      toast.error(t('composer.workspacePickerFailed'));
    }
  };
```

- [ ] **Step 5: Render compact footer pill**

Inside the footer status row, after the gateway status text and before extension status components, insert:

```tsx
            {workspaceLabel && workspacePath && (
              <button
                type="button"
                data-testid="chat-workspace-selector"
                title={workspacePath}
                aria-disabled={workspaceReadOnly ? 'true' : undefined}
                onClick={handleSelectWorkspace}
                className={cn(
                  'ml-2 inline-flex max-w-[240px] items-center gap-1 rounded-full border border-black/10 px-2 py-0.5',
                  'bg-black/[0.02] text-tiny font-medium text-foreground/75 transition-colors dark:border-white/10 dark:bg-white/[0.04]',
                  workspaceReadOnly
                    ? 'cursor-default opacity-80'
                    : 'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
              >
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {t('composer.workspacePrefix', { workspace: workspaceLabel })}
                </span>
              </button>
            )}
```

- [ ] **Step 6: Add i18n strings**

Add keys under `composer` in all four `shared/i18n/locales/<lang>/chat.json` files:

English:

```json
"workspacePrefix": "Workspace: {{workspace}}",
"workspacePickerTitle": "Choose workspace",
"workspacePickerButton": "Use workspace",
"workspacePickerFailed": "Could not open workspace picker"
```

Chinese:

```json
"workspacePrefix": "工作空间：{{workspace}}",
"workspacePickerTitle": "选择工作空间",
"workspacePickerButton": "使用此工作空间",
"workspacePickerFailed": "无法打开工作空间选择器"
```

Japanese:

```json
"workspacePrefix": "ワークスペース：{{workspace}}",
"workspacePickerTitle": "ワークスペースを選択",
"workspacePickerButton": "このワークスペースを使用",
"workspacePickerFailed": "ワークスペース選択を開けませんでした"
```

Russian:

```json
"workspacePrefix": "Рабочая область: {{workspace}}",
"workspacePickerTitle": "Выберите рабочую область",
"workspacePickerButton": "Использовать рабочую область",
"workspacePickerFailed": "Не удалось открыть выбор рабочей области"
```

Add `workspace.defaultLabel` in each locale:

```json
"workspace": {
  "defaultLabel": "默认工作空间"
}
```

Use the same Chinese label `默认工作空间` in all locales because the user explicitly requested that display label.

- [ ] **Step 7: Run ChatInput tests**

Run:

```bash
pnpm exec vitest run tests/unit/chat-input.test.tsx
```

Expected: PASS.

### Task 8: Make Right Workspace Tree Follow Effective Workspace

**Files:**
- Modify: `src/components/file-preview/ArtifactPanel.tsx`
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx`
- Modify: `tests/unit/artifact-panel.test.tsx`
- Modify: `tests/unit/workspace-browser-body.test.tsx`

- [ ] **Step 1: Write failing right-panel tests**

In `tests/unit/artifact-panel.test.tsx`, update the `WorkspaceBrowserBody` mock to capture props:

```tsx
const workspaceBrowserProps: Array<Record<string, unknown>> = [];

vi.mock('@/components/file-preview/WorkspaceBrowserBody', () => ({
  WorkspaceBrowserBody: (props: Record<string, unknown>) => {
    workspaceBrowserProps.push(props);
    return <div data-testid="workspace-browser" />;
  },
}));
```

Add this test:

```tsx
  it('passes effective workspace path to the workspace browser', () => {
    workspaceBrowserProps.length = 0;
    useArtifactPanel.setState({ open: true, tab: 'browser', focusedFile: null, widthPct: ARTIFACT_PANEL_DEFAULT_WIDTH });

    render(
      <ArtifactPanel
        files={[makeGeneratedFile()]}
        agent={{ id: 'main', name: 'Main Agent', workspace: '/agent/workspace' }}
        workspacePath="/session/workspace"
        workspaceLabel="~/session/workspace"
      />,
    );

    expect(workspaceBrowserProps.at(-1)).toMatchObject({
      workspacePath: '/session/workspace',
      workspaceLabel: '~/session/workspace',
    });
  });
```

In `tests/unit/workspace-browser-body.test.tsx`, add:

```tsx
  it('loads the explicit workspace path instead of the agent workspace', async () => {
    render(
      <WorkspaceBrowserBody
        agent={{ id: 'main', name: 'Main Agent', workspace: '/agent/workspace' }}
        workspacePath="/session/workspace"
        workspaceLabel="~/session/workspace"
      />,
    );

    await waitFor(() => {
      expect(loadWorkspaceTree).toHaveBeenCalledWith(
        '/session/workspace',
        expect.objectContaining({ includeHidden: true, runStartedAt: null }),
      );
    });
    expect(screen.getByTestId('workspace-header-title')).toHaveTextContent('Agent：Main Agent / 目录：~/session/workspace');
  });
```

- [ ] **Step 2: Run focused right-panel tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-panel.test.tsx -t "effective workspace path"
pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx -t "explicit workspace path"
```

Expected: FAIL because the props do not exist.

- [ ] **Step 3: Add ArtifactPanel workspace props**

In `src/components/file-preview/ArtifactPanel.tsx`, extend props:

```ts
  /** Effective chat workspace path resolved from OpenClaw session cwd or global selection. */
  workspacePath?: string | null;
  /** Display label for the effective workspace path. */
  workspaceLabel?: string;
```

Update the function signature and pass props to `WorkspaceBrowserBody`:

```tsx
              workspacePath={workspacePath}
              workspaceLabel={workspaceLabel}
```

- [ ] **Step 4: Add WorkspaceBrowserBody workspace props**

In `src/components/file-preview/WorkspaceBrowserBody.tsx`, update comments and props:

```ts
  /** Effective workspace root. Falls back to agent.workspace for older call sites. */
  workspacePath?: string | null;
  /** Optional display label for workspacePath. */
  workspaceLabel?: string;
```

Update destructuring:

```ts
  workspacePath,
  workspaceLabel,
```

Replace workspace display derivation:

```ts
  const workspace = workspacePath?.trim() || agent?.workspace || '';
  const treeScope = `${agent?.id ?? ''}:${workspace}`;
  const workspaceDisplayPath = workspaceLabel || formatWorkspacePath(workspace);
```

- [ ] **Step 5: Run right-panel tests**

Run:

```bash
pnpm exec vitest run tests/unit/artifact-panel.test.tsx tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS.

### Task 9: Group Sidebar Sessions By Workspace Then Recency

**Files:**
- Modify: `src/components/layout/session-buckets.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Create: `tests/unit/session-buckets.test.ts`

- [ ] **Step 1: Write failing grouping tests**

Create `tests/unit/session-buckets.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { groupSessionsByWorkspace } from '@/components/layout/session-buckets';

describe('workspace session grouping', () => {
  it('groups by workspace first and recency second', () => {
    const nowMs = new Date('2026-07-07T12:00:00Z').getTime();
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-a', workspacePath: '/repo/a', updatedAt: nowMs },
        { key: 'agent:main:session-b', workspacePath: '/repo/b', updatedAt: nowMs - 2 * 24 * 60 * 60 * 1000 },
        { key: 'agent:main:session-c', workspacePath: '/repo/a', updatedAt: nowMs - 10 * 24 * 60 * 60 * 1000 },
      ],
      {},
      nowMs,
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/a', '/repo/b']);
    expect(groups[0].buckets.find((bucket) => bucket.key === 'today')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-a']);
    expect(groups[0].buckets.find((bucket) => bucket.key === 'withinMonth')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-c']);
    expect(groups[1].buckets.find((bucket) => bucket.key === 'withinWeek')?.sessions.map((session) => session.key)).toEqual(['agent:main:session-b']);
  });

  it('puts sessions without cwd into the default workspace group', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-old', updatedAt: 1 }],
      {},
      2,
      '默认工作空间',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('默认工作空间');
  });
});
```

- [ ] **Step 2: Run grouping tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/session-buckets.test.ts
```

Expected: FAIL because `groupSessionsByWorkspace` does not exist.

- [ ] **Step 3: Add grouping helper**

In `src/components/layout/session-buckets.ts`, import helpers:

```ts
import { getSessionWorkspaceForGrouping, getWorkspaceDisplayLabel } from '@/lib/workspace-context';
```

Add types and helper:

```ts
export type SessionBucket<TSession extends ChatSession = ChatSession> = {
  key: SessionBucketKey;
  label: string;
  sessions: TSession[];
};

export type WorkspaceSessionGroup<TSession extends ChatSession = ChatSession> = {
  workspacePath: string;
  label: string;
  buckets: SessionBucket<TSession>[];
};

function createBuckets<TSession extends ChatSession>(): SessionBucket<TSession>[] {
  return [
    { key: 'today', label: 'today', sessions: [] },
    { key: 'withinWeek', label: 'withinWeek', sessions: [] },
    { key: 'withinMonth', label: 'withinMonth', sessions: [] },
    { key: 'older', label: 'older', sessions: [] },
  ];
}

export function groupSessionsByWorkspace<TSession extends ChatSession>(
  sessions: TSession[],
  sessionLastActivity: Record<string, number>,
  nowMs: number,
  defaultWorkspaceLabel: string,
): WorkspaceSessionGroup<TSession>[] {
  const groups = new Map<string, WorkspaceSessionGroup<TSession>>();
  const sorted = sessions
    .map((session) => ({ session, activityMs: getSessionActivityMs(session, sessionLastActivity) }))
    .sort((a, b) => b.activityMs - a.activityMs);

  for (const { session, activityMs } of sorted) {
    const workspacePath = getSessionWorkspaceForGrouping(session);
    let group = groups.get(workspacePath);
    if (!group) {
      group = {
        workspacePath,
        label: getWorkspaceDisplayLabel(workspacePath, defaultWorkspaceLabel),
        buckets: createBuckets<TSession>(),
      };
      groups.set(workspacePath, group);
    }
    group.buckets.find((bucket) => bucket.key === getSessionBucket(activityMs, nowMs))?.sessions.push(session);
  }

  return Array.from(groups.values());
}
```

- [ ] **Step 4: Render workspace groups in Sidebar**

In `src/components/layout/Sidebar.tsx`, replace the `sessionBuckets` construction and fill loop with:

```ts
  const workspaceSessionGroups = groupSessionsByWorkspace(
    sessions,
    sessionLastActivity,
    nowMs,
    t('chat:workspace.defaultLabel'),
  ).map((group) => ({
    ...group,
    buckets: group.buckets.map((bucket) => ({
      ...bucket,
      label: t(`chat:historyBuckets.${bucket.key}`),
    })),
  }));
```

Update imports:

```ts
import { groupSessionsByWorkspace, type SessionBucketKey } from './session-buckets';
```

In the session list JSX, replace `sessionBuckets.map(...)` with nested workspace groups:

```tsx
          {workspaceSessionGroups.map((workspaceGroup) => (
            <div key={workspaceGroup.workspacePath} data-testid={`workspace-session-group-${workspaceGroup.label}`} className="space-y-1 pt-1">
              <div className="truncate px-2.5 py-1 text-tiny font-semibold text-foreground/70" title={workspaceGroup.workspacePath}>
                {workspaceGroup.label}
              </div>
              {workspaceGroup.buckets.map((bucket) => {
                const isBucketExpanded = expandedSessionBuckets[bucket.key] ?? false;
                if (bucket.sessions.length === 0) return null;
                return (
                  <div key={`${workspaceGroup.workspacePath}:${bucket.key}`} data-testid={`session-bucket-${bucket.key}`} className="pt-1">
                    {/* keep the existing bucket button and session row rendering here unchanged */}
                  </div>
                );
              })}
            </div>
          ))}
```

When moving the existing bucket/session row JSX into the nested `map`, keep the session row code unchanged except for using `bucket.sessions` from the nested scope.

- [ ] **Step 5: Run grouping tests**

Run:

```bash
pnpm exec vitest run tests/unit/session-buckets.test.ts
```

Expected: PASS.

### Task 10: Add E2E Coverage For Workspace Context Flow

**Files:**
- Create: `tests/e2e/chat-workspace-context.spec.ts`

- [ ] **Step 1: Create E2E spec**

Create `tests/e2e/chat-workspace-context.spec.ts` with:

```ts
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-a';
const SESSION_WORKSPACE = '/Users/e2e/workspace/ClawX';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

async function installWorkspaceMocks(app: ElectronApplication) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'Workspace chat', updatedAt: Date.now() }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
        success: true,
        result: { messages: [] },
      },
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', undefined])]: {
        chatWorkspacePath: '~/.openclaw/workspace',
        recentWorkspacePaths: ['~/.openclaw/workspace'],
      },
      [stableStringify(['sessions', 'summaries', { sessionKeys: [SESSION_KEY] }])]: {
        success: true,
        summaries: [{ sessionKey: SESSION_KEY, firstUserText: null, lastTimestamp: null, workspacePath: SESSION_WORKSPACE }],
      },
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, cwd: SESSION_WORKSPACE }])]: {
        success: true,
        generation: 1,
      },
      [stableStringify(['files', 'listTree', { path: SESSION_WORKSPACE, opts: { includeHidden: true } }])]: {
        ok: true,
        root: { name: 'ClawX', relPath: '', absPath: SESSION_WORKSPACE, isDir: true, children: [] },
        truncated: false,
      },
    },
  });
}

test.afterEach(async ({ electronApp }) => {
  await closeElectronApp(electronApp);
});

test('bound session shows read-only workspace and workspace tree uses the same cwd', async ({ electronApp }) => {
  await installWorkspaceMocks(electronApp);
  const page = await getStableWindow(electronApp);
  await page.goto('app://./index.html');

  await expect(page.getByTestId('chat-workspace-selector')).toContainText('ClawX');
  await expect(page.getByTestId('chat-workspace-selector')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('chat-toolbar-workspace').click();
  await page.getByTestId('artifact-panel-tab-browser').click();
  await expect(page.getByTestId('workspace-header-title')).toContainText('ClawX');
  await expect(page.getByTestId('workspace-session-group-~/workspace/ClawX')).toBeVisible();
});
```

- [ ] **Step 2: Run the E2E spec and verify failures are implementation-related**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
```

Expected before implementation: FAIL because test ids and workspace behavior are not complete. Expected after prior tasks: PASS or expose only fixture key mismatches to adjust in this spec.

### Task 11: Run Validation And Documentation Review

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Modify docs only if they describe chat workspace/session behavior.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run targeted unit tests**

Run:

```bash
pnpm exec vitest run tests/unit/workspace-context.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/session-buckets.test.ts tests/unit/chat-acp-page.test.tsx tests/unit/chat-input.test.tsx tests/unit/workspace-browser-body.test.tsx tests/unit/artifact-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm run build:vite
```

Expected: PASS.

- [ ] **Step 4: Run E2E spec**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-workspace-context.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run comms replay and compare**

Run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected: both commands PASS with no regressions reported.

- [ ] **Step 6: Review docs**

Read `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. If they do not document chat workspace selection or session cwd behavior, leave them unchanged and report that no docs update was needed. If they do document those flows, add a short sentence explaining that existing sessions use their OpenClaw cwd and new sessions use the footer-selected workspace.

- [ ] **Step 7: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- docs/superpowers/specs/2026-07-07-chat-workspace-context-design.md docs/superpowers/plans/2026-07-07-chat-workspace-context.md
```

Expected: only intended files are changed. Do not commit unless the user explicitly requests a commit.

# Sidebar Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sidebar date buckets with workspace-first session groups, polish workspace context tags, and move composer workspace selection into a dropdown-style control.

**Architecture:** Keep the current component boundaries and make the smallest focused changes. `session-buckets.ts` becomes a workspace grouping helper with flat sorted sessions; `Sidebar.tsx` owns collapse and visible-count UI state; `ChatInput.tsx` owns the lightweight workspace menu; `WorkspaceBrowserBody.tsx` owns tag rendering for agent/path context.

**Tech Stack:** React 19, TypeScript, Vite, Electron, Zustand stores, Tailwind tokens, react-i18next, Vitest, Playwright, `timeago.js`.

---

## File Structure

- Modify `package.json` and `pnpm-lock.yaml`: add `timeago.js` through `pnpm add timeago.js`.
- Create `src/lib/relative-time.ts`: register timeago locales once and export `formatSessionRelativeTime(timestampMs, nowMs, language)`.
- Modify `src/components/layout/session-buckets.ts`: remove date buckets and return workspace groups with flat session arrays and activity timestamps.
- Modify `src/components/layout/Sidebar.tsx`: render the new session list header, icon-based collapse-all control, workspace headers, load-more controls, collapse state, relative time, and stronger workspace typography.
- Modify `src/components/file-preview/WorkspaceBrowserBody.tsx`: replace the combined header string with agent and path tag components.
- Modify `src/pages/Chat/ChatInput.tsx`: add workspace dropdown menu, keep read-only chip, and right-align gateway status.
- Modify `shared/i18n/locales/{en,zh,ja,ru}/chat.json`: add new `sessionList` and composer menu strings.
- Modify `tests/unit/session-buckets.test.ts`: assert flat grouping, ordering, and default workspace priority.
- Modify `tests/unit/sidebar-session-buckets.test.ts`: update helper tests from date bucket IDs to workspace group IDs and relative-time helpers.
- Modify `tests/unit/chat-input.test.tsx`: cover workspace menu behavior and read-only chip behavior.
- Modify `tests/unit/workspace-browser-body.test.tsx`: cover agent/path tags and final path segment styling.
- Modify `tests/e2e/chat-new-session-date.spec.ts`: repurpose from date buckets to workspace session list behavior.
- Modify `tests/e2e/chat-acp-inline-timeline.spec.ts`, `tests/e2e/dialog-transitions.spec.ts`, `tests/e2e/chat-workspace-context.spec.ts`, and `tests/e2e/chat-file-changes.spec.ts`: replace old date-bucket/header selector expectations.

No commit steps are included because this workspace should not commit unless the user explicitly requests it.

---

### Task 1: Add Relative Time Utility

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/lib/relative-time.ts`
- Test: `tests/unit/sidebar-session-buckets.test.ts`

- [ ] **Step 1: Add the dependency**

Run:

```bash
pnpm add timeago.js
```

Expected: `package.json` contains `timeago.js` in dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write failing relative-time tests**

In `tests/unit/sidebar-session-buckets.test.ts`, replace the date-bucket-specific tests with tests for session activity and relative time. Keep the `getSessionActivityMs` tests and add:

```ts
import { describe, expect, it } from 'vitest';
import { getSessionActivityMs } from '@/components/layout/session-buckets';
import {
  getWorkspaceGroupStateKey,
  getWorkspaceGroupTestId,
  getWorkspaceGroupToggleTestId,
} from '@/components/layout/Sidebar';
import { formatSessionRelativeTime } from '@/lib/relative-time';

describe('sidebar session helpers', () => {
  it('uses the timestamp embedded in a locally-created session key as activity fallback', () => {
    const createdAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const session = {
      key: `agent:main:session-${createdAtMs}`,
      displayName: `agent:main:session-${createdAtMs}`,
    };

    const activityMs = getSessionActivityMs(session, {});

    expect(activityMs).toBe(createdAtMs);
  });

  it('prefers real message activity over backend metadata or key creation time', () => {
    const keyCreatedAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const updatedAtMs = new Date('2026-05-06T11:00:00.000Z').getTime();
    const messageActivityMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(getSessionActivityMs(
      {
        key: `agent:main:session-${keyCreatedAtMs}`,
        updatedAt: updatedAtMs,
      },
      { [`agent:main:session-${keyCreatedAtMs}`]: messageActivityMs },
    )).toBe(messageActivityMs);
  });

  it('uses workspace-scoped group state keys and test ids', () => {
    expect(getWorkspaceGroupStateKey('/repo/a')).not.toBe(getWorkspaceGroupStateKey('/repo/b'));
    expect(getWorkspaceGroupTestId('/repo/a')).not.toBe(getWorkspaceGroupTestId('/repo/b'));
    expect(getWorkspaceGroupToggleTestId('/repo/a')).not.toBe(getWorkspaceGroupToggleTestId('/repo/b'));
    expect(getWorkspaceGroupTestId('/repo/a-b')).not.toBe(getWorkspaceGroupTestId('/repo/a/b'));
    expect(getWorkspaceGroupToggleTestId('/repo/a-b')).not.toBe(getWorkspaceGroupToggleTestId('/repo/a/b'));
  });

  it('formats activity timestamps through timeago with locale mapping', () => {
    const nowMs = new Date('2026-05-06T12:00:00.000Z').getTime();
    const activityMs = nowMs - 2 * 60 * 60 * 1000;

    expect(formatSessionRelativeTime(activityMs, nowMs, 'en')).toBe('2 hours ago');
    expect(formatSessionRelativeTime(activityMs, nowMs, 'zh')).toContain('2');
    expect(formatSessionRelativeTime(0, nowMs, 'en')).toBe('');
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
pnpm vitest run tests/unit/sidebar-session-buckets.test.ts
```

Expected: FAIL because `formatSessionRelativeTime`, `getWorkspaceGroupStateKey`, `getWorkspaceGroupTestId`, and `getWorkspaceGroupToggleTestId` do not exist yet.

- [ ] **Step 4: Create the relative-time utility**

Create `src/lib/relative-time.ts`:

```ts
import { format, register } from 'timeago.js';
import zhCN from 'timeago.js/lib/zh_CN';
import ja from 'timeago.js/lib/ja';
import ru from 'timeago.js/lib/ru';

let localesRegistered = false;

function ensureTimeagoLocalesRegistered() {
  if (localesRegistered) return;
  register('zh_CN', zhCN);
  register('ja', ja);
  register('ru', ru);
  localesRegistered = true;
}

export function getTimeagoLocale(language?: string): string {
  const normalized = (language || '').toLowerCase();
  if (normalized.startsWith('zh')) return 'zh_CN';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('ru')) return 'ru';
  return 'en_US';
}

export function formatSessionRelativeTime(timestampMs: number, nowMs: number, language?: string): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '';
  ensureTimeagoLocalesRegistered();
  return format(timestampMs, getTimeagoLocale(language), { relativeDate: nowMs });
}
```

- [ ] **Step 5: Run the relative-time tests again**

Run:

```bash
pnpm vitest run tests/unit/sidebar-session-buckets.test.ts
```

Expected: still FAIL only on missing workspace group helper exports until Task 2 updates `Sidebar.tsx`.

---

### Task 2: Refactor Workspace Grouping

**Files:**
- Modify: `src/components/layout/session-buckets.ts`
- Modify: `tests/unit/session-buckets.test.ts`
- Test: `tests/unit/session-buckets.test.ts`

- [ ] **Step 1: Write failing grouping tests**

Replace `tests/unit/session-buckets.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { groupSessionsByWorkspace } from '@/components/layout/session-buckets';

describe('workspace session grouping', () => {
  it('groups by workspace and sorts sessions by activity inside each workspace', () => {
    const nowMs = new Date('2026-07-07T12:00:00Z').getTime();
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-a', workspacePath: '/repo/a', updatedAt: nowMs - 60_000 },
        { key: 'agent:main:session-b', workspacePath: '/repo/b', updatedAt: nowMs - 2 * 24 * 60 * 60 * 1000 },
        { key: 'agent:main:session-c', workspacePath: '/repo/a', updatedAt: nowMs - 10 * 24 * 60 * 60 * 1000 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['/repo/a', '/repo/b']);
    expect(groups[0].sessions.map((entry) => entry.session.key)).toEqual(['agent:main:session-a', 'agent:main:session-c']);
    expect(groups[0].sessions.map((entry) => entry.activityMs)).toEqual([nowMs - 60_000, nowMs - 10 * 24 * 60 * 60 * 1000]);
  });

  it('puts the default workspace first even when another workspace has newer activity', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-project', workspacePath: '/repo/z', updatedAt: 20 },
        { key: 'agent:main:session-default', updatedAt: 10 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual(['~/.openclaw/workspace', '/repo/z']);
    expect(groups[0].label).toBe('默认工作空间');
  });

  it('sorts non-default workspaces by natural label order', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-b', workspacePath: '/repo/project-10', updatedAt: 30 },
        { key: 'agent:main:session-a', workspacePath: '/repo/project-2', updatedAt: 20 },
        { key: 'agent:main:session-c', workspacePath: '/repo/project-1', updatedAt: 10 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups.map((group) => group.workspacePath)).toEqual([
      '/repo/project-1',
      '/repo/project-2',
      '/repo/project-10',
    ]);
  });

  it('groups locally-created sessions without cwd under the selected global workspace', () => {
    const groups = groupSessionsByWorkspace(
      [{ key: 'agent:main:session-pending', createdLocally: true, updatedAt: 1 }],
      {},
      '默认工作空间',
      '/repo/global',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('/repo/global');
  });

  it('groups default-equivalent workspace paths with sessions missing cwd', () => {
    const groups = groupSessionsByWorkspace(
      [
        { key: 'agent:main:session-no-cwd', updatedAt: 2 },
        { key: 'agent:main:session-default-path', workspacePath: '/Users/alex/.openclaw/workspace', updatedAt: 1 },
      ],
      {},
      '默认工作空间',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].workspacePath).toBe('~/.openclaw/workspace');
    expect(groups[0].label).toBe('默认工作空间');
  });
});
```

- [ ] **Step 2: Run the grouping tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/session-buckets.test.ts
```

Expected: FAIL because `groups[0].sessions` does not exist; current groups still expose `buckets`.

- [ ] **Step 3: Replace the grouping helper implementation**

Rewrite `src/components/layout/session-buckets.ts` to expose flat workspace groups:

```ts
import type { ChatSession } from '@/stores/chat';
import {
  DEFAULT_WORKSPACE_CWD,
  getSessionWorkspaceForGrouping,
  getWorkspaceDisplayLabel,
  isDefaultWorkspacePath,
} from '@/lib/workspace-context';

export type WorkspaceSessionEntry<TSession> = {
  session: TSession;
  activityMs: number;
};

export type WorkspaceSessionGroup<TSession> = {
  workspacePath: string;
  label: string;
  sessions: Array<WorkspaceSessionEntry<TSession>>;
};

function getSessionCreatedAtMsFromKey(sessionKey: string): number | undefined {
  const match = sessionKey.match(/(?:^|:)session-(\d{11,})(?=$|:)/);
  if (!match) return undefined;

  const createdAtMs = Number(match[1]);
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined;
}

export function getSessionActivityMs(
  session: ChatSession,
  sessionLastActivity: Record<string, number>,
): number {
  const lastActivityMs = sessionLastActivity[session.key];
  if (Number.isFinite(lastActivityMs) && lastActivityMs > 0) return lastActivityMs;

  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0) {
    return session.updatedAt;
  }

  return getSessionCreatedAtMsFromKey(session.key) ?? 0;
}

function getCanonicalWorkspacePathForGrouping(
  session: ChatSession,
  globalWorkspace?: string | null,
): string {
  const workspacePath = getSessionWorkspaceForGrouping(session, globalWorkspace);
  return isDefaultWorkspacePath(workspacePath) ? DEFAULT_WORKSPACE_CWD : workspacePath;
}

function compareWorkspaceGroups<TSession>(
  left: WorkspaceSessionGroup<TSession>,
  right: WorkspaceSessionGroup<TSession>,
): number {
  const leftDefault = isDefaultWorkspacePath(left.workspacePath);
  const rightDefault = isDefaultWorkspacePath(right.workspacePath);
  if (leftDefault && !rightDefault) return -1;
  if (!leftDefault && rightDefault) return 1;

  const byLabel = left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
  if (byLabel !== 0) return byLabel;
  return left.workspacePath.localeCompare(right.workspacePath, undefined, { numeric: true, sensitivity: 'base' });
}

export function groupSessionsByWorkspace<TSession extends ChatSession>(
  sessions: readonly TSession[],
  sessionLastActivity: Record<string, number>,
  defaultWorkspaceLabel: string,
  globalWorkspace?: string | null,
): Array<WorkspaceSessionGroup<TSession>> {
  const groupByWorkspace = new Map<string, WorkspaceSessionGroup<TSession>>();

  for (const session of sessions) {
    const workspacePath = getCanonicalWorkspacePathForGrouping(session, globalWorkspace);
    let group = groupByWorkspace.get(workspacePath);
    if (!group) {
      group = {
        workspacePath,
        label: getWorkspaceDisplayLabel(workspacePath, defaultWorkspaceLabel),
        sessions: [],
      };
      groupByWorkspace.set(workspacePath, group);
    }
    group.sessions.push({
      session,
      activityMs: getSessionActivityMs(session, sessionLastActivity),
    });
  }

  return Array.from(groupByWorkspace.values())
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((left, right) => right.activityMs - left.activityMs),
    }))
    .sort(compareWorkspaceGroups);
}
```

- [ ] **Step 4: Run grouping tests**

Run:

```bash
pnpm vitest run tests/unit/session-buckets.test.ts
```

Expected: PASS.

---

### Task 3: Rebuild Sidebar Session List UI

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `tests/unit/sidebar-session-buckets.test.ts`
- Test: `tests/unit/sidebar-session-buckets.test.ts`

- [ ] **Step 1: Update helper exports for workspace groups**

In `src/components/layout/Sidebar.tsx`, replace `SessionBucketKey` imports and old bucket helpers with workspace-group helpers:

```ts
import { groupSessionsByWorkspace } from './session-buckets';
import { formatSessionRelativeTime } from '@/lib/relative-time';
```

Add constants and helpers near the existing `getWorkspaceTestIdSegment` function:

```ts
const INITIAL_NOW_MS = Date.now();
const INITIAL_WORKSPACE_SESSION_LIMIT = 5;
const WORKSPACE_SESSION_LIMIT_INCREMENT = 5;

function getWorkspaceTestIdSegment(workspacePath: string): string {
  return encodeURIComponent(workspacePath.trim() || 'workspace');
}

export function getWorkspaceGroupStateKey(workspacePath: string): string {
  return workspacePath;
}

export function getWorkspaceGroupTestId(workspacePath: string): string {
  return `workspace-session-group-${getWorkspaceTestIdSegment(workspacePath)}`;
}

export function getWorkspaceGroupToggleTestId(workspacePath: string): string {
  return `workspace-session-group-toggle-${getWorkspaceTestIdSegment(workspacePath)}`;
}

function getWorkspaceLoadMoreTestId(workspacePath: string): string {
  return `workspace-session-load-more-${getWorkspaceTestIdSegment(workspacePath)}`;
}
```

- [ ] **Step 2: Remove bucket state and add workspace UI state**

In `Sidebar`, replace:

```ts
const [expandedSessionBuckets, setExpandedSessionBuckets] = useState<Record<string, boolean>>({});
```

with:

```ts
const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Record<string, boolean>>({});
const [workspaceVisibleSessionCounts, setWorkspaceVisibleSessionCounts] = useState<Record<string, number>>({});
```

Delete `toggleSessionBucket`. Add:

```ts
const toggleWorkspaceGroup = (workspacePath: string) => {
  const stateKey = getWorkspaceGroupStateKey(workspacePath);
  setCollapsedWorkspaceGroups((current) => ({
    ...current,
    [stateKey]: !(current[stateKey] ?? false),
  }));
};

const allWorkspaceGroupsCollapsed = workspaceSessionGroups.length > 0
  && workspaceSessionGroups.every((group) => collapsedWorkspaceGroups[getWorkspaceGroupStateKey(group.workspacePath)] ?? false);

const toggleAllWorkspaceGroups = () => {
  const nextCollapsed = !allWorkspaceGroupsCollapsed;
  setCollapsedWorkspaceGroups((current) => {
    const next = { ...current };
    for (const group of workspaceSessionGroups) {
      next[getWorkspaceGroupStateKey(group.workspacePath)] = nextCollapsed;
    }
    return next;
  });
};

const loadMoreWorkspaceSessions = (workspacePath: string) => {
  const stateKey = getWorkspaceGroupStateKey(workspacePath);
  setWorkspaceVisibleSessionCounts((current) => ({
    ...current,
    [stateKey]: (current[stateKey] ?? INITIAL_WORKSPACE_SESSION_LIMIT) + WORKSPACE_SESSION_LIMIT_INCREMENT,
  }));
};
```

- [ ] **Step 3: Update workspace grouping call**

Replace the current call that passes `nowMs`:

```ts
const workspaceSessionGroups = groupSessionsByWorkspace(
  sessions,
  sessionLastActivity,
  t('chat:workspace.defaultLabel'),
  chatWorkspacePath,
);
```

Remove `historyBucketLabels` entirely.

- [ ] **Step 4: Replace session list JSX**

Replace the entire block under `{!sidebarCollapsed && sessions.length > 0 && (` with this structure, adapting only indentation and keeping existing rename/delete handlers unchanged:

```tsx
{!sidebarCollapsed && sessions.length > 0 && (
  <div className="mt-4 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
    <div className="mb-1 flex items-center justify-between gap-2 px-2.5">
      <span className="text-tiny font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
        {t('chat:sessionList.title')}
      </span>
      <button
        type="button"
        data-testid="session-list-toggle-all"
        aria-label={allWorkspaceGroupsCollapsed ? t('chat:sessionList.expandAll') : t('chat:sessionList.collapseAll')}
        title={allWorkspaceGroupsCollapsed ? t('chat:sessionList.expandAll') : t('chat:sessionList.collapseAll')}
        onClick={toggleAllWorkspaceGroups}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
      >
        <span aria-hidden="true">{/* icon for expand/collapse all */}</span>
      </button>
    </div>

    <div className="space-y-1.5">
      {workspaceSessionGroups.map((workspaceGroup) => {
        const workspaceStateKey = getWorkspaceGroupStateKey(workspaceGroup.workspacePath);
        const collapsed = collapsedWorkspaceGroups[workspaceStateKey] ?? false;
        const visibleCount = workspaceVisibleSessionCounts[workspaceStateKey] ?? INITIAL_WORKSPACE_SESSION_LIMIT;
        const visibleSessions = workspaceGroup.sessions.slice(0, visibleCount);
        const hiddenCount = Math.max(0, workspaceGroup.sessions.length - visibleSessions.length);

        return (
          <div
            key={workspaceGroup.workspacePath}
            data-testid={getWorkspaceGroupTestId(workspaceGroup.workspacePath)}
            className="space-y-1"
          >
            <button
              type="button"
              data-testid={getWorkspaceGroupToggleTestId(workspaceGroup.workspacePath)}
              aria-expanded={!collapsed}
              aria-label={t('chat:sessionList.workspaceToggle', { workspace: workspaceGroup.label })}
              onClick={() => toggleWorkspaceGroup(workspaceGroup.workspacePath)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-meta font-semibold text-foreground/75 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
              title={workspaceGroup.label}
            >
              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
              <span className="min-w-0 flex-1 truncate">{workspaceGroup.label}</span>
              <span className="shrink-0 text-2xs font-medium text-muted-foreground/60">{workspaceGroup.sessions.length}</span>
            </button>

            {!collapsed && (
              <div className="space-y-0.5">
                {visibleSessions.map(({ session: s, activityMs }) => {
                  const agentId = getAgentIdFromSessionKey(s.key);
                  const agentName = agentNameById[agentId] || agentId;
                  const isEditing = editingSessionKey === s.key;
                  const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
                  const relativeTime = formatSessionRelativeTime(activityMs, nowMs, i18n.language);
                  const channelType = s.channel && s.channel !== 'webchat' ? s.channel : null;
                  const channelName = channelType
                    ? (CHANNEL_NAMES[channelType as keyof typeof CHANNEL_NAMES] ?? channelType)
                    : null;

                  return (
                    <div
                      key={s.key}
                      className={cn(
                        'group flex items-center rounded-lg transition-colors',
                        'hover:bg-black/5 focus-within:bg-black/5 dark:hover:bg-white/5 dark:focus-within:bg-white/5',
                        !isEditing && isOnChat && currentSessionKey === s.key
                          ? 'bg-black/5 dark:bg-white/10'
                          : '',
                      )}
                    >
                      {/* keep the existing editing and non-editing row body here, with the non-editing action area changed in Step 5 */}
                    </div>
                  );
                })}

                {hiddenCount > 0 && (
                  <button
                    type="button"
                    data-testid={getWorkspaceLoadMoreTestId(workspaceGroup.workspacePath)}
                    onClick={() => loadMoreWorkspaceSessions(workspaceGroup.workspacePath)}
                    className="ml-7 rounded-md px-2 py-1 text-tiny font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                  >
                    {t('chat:sessionList.loadMore', { count: Math.min(WORKSPACE_SESSION_LIMIT_INCREMENT, hiddenCount) })}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
)}
```

At the top of `Sidebar`, change the translation hook to retain `i18n`:

```ts
const { t, i18n } = useTranslation(['common', 'chat']);
```

- [ ] **Step 5: Change row trailing controls**

In the non-editing row body, keep the existing session button and replace the trailing action container with a time label plus hover actions:

```tsx
{relativeTime && (
  <span
    title={new Date(activityMs).toLocaleString()}
    className="shrink-0 pr-2 text-2xs font-medium text-muted-foreground/55 group-hover:hidden group-focus-within:hidden"
  >
    {relativeTime}
  </span>
)}
<div className="hidden items-center gap-0.5 pr-1.5 group-hover:flex group-focus-within:flex">
  <button
    aria-label={t('common:sidebar.renameSession')}
    onClick={(e) => {
      e.stopPropagation();
      handleStartRename(s.key, sessionLabel);
    }}
    className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
  >
    <Pencil className="h-3.5 w-3.5" />
  </button>
  <button
    data-testid={`sidebar-session-delete-${s.key}`}
    aria-label={t('common:sidebar.deleteSession')}
    onClick={(e) => {
      e.stopPropagation();
      setSessionToDelete({
        key: s.key,
        label: sessionLabel,
      });
      setDeleteDialogOpen(true);
    }}
    className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
  >
    <Trash2 className="h-3.5 w-3.5" />
  </button>
</div>
```

- [ ] **Step 6: Run sidebar helper tests**

Run:

```bash
pnpm vitest run tests/unit/sidebar-session-buckets.test.ts tests/unit/session-buckets.test.ts
```

Expected: PASS.

---

### Task 4: Add Sidebar I18n Strings

**Files:**
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: Typecheck and component tests from later tasks

- [ ] **Step 1: Add English strings**

In `shared/i18n/locales/en/chat.json`, add after the `composer` block or before `historyBuckets`:

```json
"sessionList": {
  "title": "Sessions",
  "collapseAll": "Collapse all",
  "expandAll": "Expand all",
  "loadMore": "Load {{count}} more",
  "workspaceToggle": "Toggle workspace {{workspace}}"
}
```

Also add these `composer` keys:

```json
"defaultWorkspaceOption": "Default workspace",
"chooseOtherWorkspaceOption": "Choose another folder..."
```

- [ ] **Step 2: Add Chinese strings**

In `shared/i18n/locales/zh/chat.json`, add:

```json
"sessionList": {
  "title": "会话列表",
  "collapseAll": "一键折叠",
  "expandAll": "一键展开",
  "loadMore": "加载 {{count}} 个更多",
  "workspaceToggle": "展开或折叠工作空间 {{workspace}}"
}
```

Add composer keys:

```json
"defaultWorkspaceOption": "默认工作空间",
"chooseOtherWorkspaceOption": "选择其他目录…"
```

- [ ] **Step 3: Add Japanese strings**

In `shared/i18n/locales/ja/chat.json`, add:

```json
"sessionList": {
  "title": "セッション一覧",
  "collapseAll": "すべて折りたたむ",
  "expandAll": "すべて展開",
  "loadMore": "さらに {{count}} 件読み込む",
  "workspaceToggle": "ワークスペース {{workspace}} を切り替え"
}
```

Add composer keys:

```json
"defaultWorkspaceOption": "既定のワークスペース",
"chooseOtherWorkspaceOption": "別のディレクトリを選択…"
```

- [ ] **Step 4: Add Russian strings**

In `shared/i18n/locales/ru/chat.json`, add:

```json
"sessionList": {
  "title": "Список сессий",
  "collapseAll": "Свернуть все",
  "expandAll": "Развернуть все",
  "loadMore": "Загрузить еще {{count}}",
  "workspaceToggle": "Переключить рабочую область {{workspace}}"
}
```

Add composer keys:

```json
"defaultWorkspaceOption": "Рабочая область по умолчанию",
"chooseOtherWorkspaceOption": "Выбрать другой каталог…"
```

- [ ] **Step 5: Verify locale JSON parses**

Run:

```bash
pnpm exec eslint shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json
```

Expected: PASS.

---

### Task 5: Workspace Browser Header Tags

**Files:**
- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx`
- Modify: `tests/unit/workspace-browser-body.test.tsx`
- Test: `tests/unit/workspace-browser-body.test.tsx`

- [ ] **Step 1: Write failing tests for tag header**

Update the first three header assertions in `tests/unit/workspace-browser-body.test.tsx` to expect separate tags:

```ts
expect(screen.getByTestId('workspace-agent-tag')).toHaveTextContent('Main Agent');
expect(screen.getByTestId('workspace-path-tag')).toHaveTextContent('~/session/workspace');
expect(screen.getByTestId('workspace-path-final-segment')).toHaveTextContent('workspace');
expect(screen.getByTestId('workspace-path-final-segment')).toHaveClass('font-semibold');
expect(screen.getByTestId('workspace-header-title')).not.toHaveTextContent('Agent：');
```

For the fallback agent workspace test, assert:

```ts
expect(screen.getByTestId('workspace-path-tag')).toHaveTextContent('/agent/workspace');
expect(screen.getByTestId('workspace-path-tag')).not.toHaveTextContent('~/session/workspace');
```

For the home-shortening test, assert:

```ts
expect(screen.getByTestId('workspace-path-prefix')).toHaveTextContent('~/.openclaw/');
expect(screen.getByTestId('workspace-path-final-segment')).toHaveTextContent('workspace-main');
expect(screen.getByTestId('workspace-header-title')).toHaveAttribute(
  'title',
  'Main Agent / /Users/alex/.openclaw/workspace-main',
);
```

- [ ] **Step 2: Run workspace browser tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/workspace-browser-body.test.tsx
```

Expected: FAIL because the tag test IDs do not exist.

- [ ] **Step 3: Add path splitting helper and tag components**

In `src/components/file-preview/WorkspaceBrowserBody.tsx`, remove `workspaceHeaderTitle` and add helpers above `WorkspaceBrowserBody`:

```tsx
function splitDisplayPath(displayPath: string): { prefix: string; finalSegment: string } {
  const value = displayPath.trim();
  if (!value) return { prefix: '', finalSegment: '-' };
  const normalized = value.replace(/\\/g, '/');
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex < 0) return { prefix: '', finalSegment: trimmed };
  if (slashIndex === 0) return { prefix: '/', finalSegment: trimmed.slice(1) || trimmed };
  return {
    prefix: `${trimmed.slice(0, slashIndex + 1)}`,
    finalSegment: trimmed.slice(slashIndex + 1) || trimmed,
  };
}

function HeaderTag({ children, testId, title }: { children: React.ReactNode; testId: string; title?: string }) {
  return (
    <span
      data-testid={testId}
      title={title}
      className="inline-flex h-7 min-w-0 items-center rounded-full border border-black/10 bg-black/[0.03] px-2.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]"
    >
      {children}
    </span>
  );
}

function WorkspacePathTag({ displayPath, title }: { displayPath: string; title: string }) {
  const { prefix, finalSegment } = splitDisplayPath(displayPath);
  return (
    <HeaderTag testId="workspace-path-tag" title={title}>
      <span data-testid="workspace-path-prefix" className="min-w-0 truncate text-muted-foreground">
        {prefix}
      </span>
      <span data-testid="workspace-path-final-segment" className="shrink-0 font-semibold text-foreground">
        {finalSegment}
      </span>
    </HeaderTag>
  );
}
```

- [ ] **Step 4: Replace header title JSX**

Replace the current `<h2 data-testid="workspace-header-title">` block with:

```tsx
<div
  data-testid="workspace-header-title"
  title={`${agentDisplayName} / ${workspace || directoryDisplayPath}`}
  className="flex min-w-0 items-center gap-1.5"
>
  <HeaderTag testId="workspace-agent-tag" title={agentDisplayName}>
    <span className="truncate">{agentDisplayName}</span>
  </HeaderTag>
  <WorkspacePathTag
    displayPath={directoryDisplayPath}
    title={workspace || directoryDisplayPath}
  />
</div>
```

- [ ] **Step 5: Run workspace browser tests**

Run:

```bash
pnpm vitest run tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS.

---

### Task 6: Composer Workspace Dropdown

**Files:**
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `tests/unit/chat-input.test.tsx`
- Test: `tests/unit/chat-input.test.tsx`

- [ ] **Step 1: Update tests for menu behavior**

In `tests/unit/chat-input.test.tsx`, add translations in `translate`:

```ts
case 'composer.defaultWorkspaceOption':
  return 'Default workspace';
case 'composer.chooseOtherWorkspaceOption':
  return 'Choose another folder...';
```

Change the existing native picker test to click the menu option:

```ts
fireEvent.click(screen.getByTestId('chat-workspace-selector'));
expect(screen.getByTestId('chat-workspace-menu')).toBeInTheDocument();
fireEvent.click(screen.getByTestId('chat-workspace-choose-other'));
```

Add a new test:

```ts
it('workspace selector can choose the default workspace from the menu', () => {
  const onSelectWorkspace = vi.fn();

  render(
    <TooltipProvider>
      <ChatInput
        onSend={vi.fn()}
        workspaceLabel="~/workspace/ClawX"
        workspacePath="/Users/alex/workspace/ClawX"
        workspaceReadOnly={false}
        onSelectWorkspace={onSelectWorkspace}
      />
    </TooltipProvider>,
  );

  fireEvent.click(screen.getByTestId('chat-workspace-selector'));
  fireEvent.click(screen.getByTestId('chat-workspace-default'));

  expect(onSelectWorkspace).toHaveBeenCalledWith('~/.openclaw/workspace');
  expect(hostApiDialogOpenMock).not.toHaveBeenCalled();
});
```

Update the read-only selector test to assert no menu:

```ts
fireEvent.click(screen.getByTestId('chat-workspace-selector'));
expect(screen.queryByTestId('chat-workspace-menu')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run chat input tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/chat-input.test.tsx
```

Expected: FAIL because the workspace menu and options do not exist.

- [ ] **Step 3: Add workspace menu state and default workspace import**

In `src/pages/Chat/ChatInput.tsx`, add:

```ts
import { DEFAULT_WORKSPACE_CWD } from '@/lib/workspace-context';
```

Add state and ref near other picker state:

```ts
const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
const workspaceMenuRef = useRef<HTMLDivElement>(null);
```

In the document-click effect that currently handles `pickerRef`, `skillPickerRef`, and `modelPickerRef`, include `workspaceMenuRef` and close `workspaceMenuOpen` when clicking outside. If there is no shared effect, add:

```ts
useEffect(() => {
  if (!workspaceMenuOpen) return;
  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && workspaceMenuRef.current?.contains(target)) return;
    setWorkspaceMenuOpen(false);
  };
  document.addEventListener('pointerdown', handlePointerDown);
  return () => document.removeEventListener('pointerdown', handlePointerDown);
}, [workspaceMenuOpen]);
```

- [ ] **Step 4: Split picker behavior into menu and native dialog**

Rename the current `handleSelectWorkspace` to `handleChooseOtherWorkspace` and keep the native dialog body. Add:

```ts
const handleWorkspaceButtonClick = useCallback(() => {
  if (workspaceSelectorDisabled) return;
  setPickerOpen(false);
  setSkillPickerOpen(false);
  setModelPickerOpen(false);
  setWorkspaceMenuOpen((open) => !open);
}, [workspaceSelectorDisabled]);

const handleSelectDefaultWorkspace = useCallback(() => {
  if (workspaceSelectorDisabled || !onSelectWorkspace) return;
  onSelectWorkspace(DEFAULT_WORKSPACE_CWD);
  setWorkspaceMenuOpen(false);
  textareaRef.current?.focus();
}, [onSelectWorkspace, workspaceSelectorDisabled]);

const handleChooseOtherWorkspace = useCallback(async () => {
  if (workspaceSelectorDisabled || !onSelectWorkspace) return;
  setWorkspaceMenuOpen(false);
  try {
    const result = await hostApi.dialog.open({
      title: t('composer.workspacePickerTitle'),
      buttonLabel: t('composer.workspacePickerButton'),
      defaultPath: workspacePath,
      properties: ['openDirectory', 'createDirectory'],
    });
    const selected = result.filePaths[0]?.trim();
    if (!result.canceled && selected) onSelectWorkspace(selected);
  } catch {
    toast.error(t('composer.workspacePickerFailed'));
  } finally {
    textareaRef.current?.focus();
  }
}, [onSelectWorkspace, t, workspacePath, workspaceSelectorDisabled]);
```

When opening agent, skill, or model pickers, add `setWorkspaceMenuOpen(false);` alongside the existing picker-closing calls.

- [ ] **Step 5: Replace composer footer JSX**

Replace the current footer block starting with `<div className="mt-2.5 flex...` with:

```tsx
<div className="mt-2.5 flex min-w-0 items-center justify-between gap-2 px-4 text-tiny text-muted-foreground/60">
  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
    {workspaceLabel && workspacePath && (
      <div ref={workspaceMenuRef} className="relative min-w-0 shrink">
        <button
          type="button"
          data-testid="chat-workspace-selector"
          title={workspacePath}
          aria-disabled={workspaceSelectorDisabled ? 'true' : undefined}
          aria-expanded={!workspaceSelectorDisabled ? workspaceMenuOpen : undefined}
          onClick={workspaceReadOnly ? undefined : handleWorkspaceButtonClick}
          className={cn(
            'inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-full border border-black/10 px-2 py-0.5',
            'bg-black/[0.02] text-tiny font-medium text-foreground/75 transition-colors dark:border-white/10 dark:bg-white/[0.04]',
            workspaceSelectorDisabled
              ? 'cursor-default opacity-80'
              : 'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
          )}
        >
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">
            {t('composer.workspacePrefix', { workspace: workspaceLabel })}
          </span>
          {!workspaceSelectorDisabled && <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', workspaceMenuOpen && 'rotate-180')} />}
        </button>
        {workspaceMenuOpen && !workspaceSelectorDisabled && (
          <div
            data-testid="chat-workspace-menu"
            className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
          >
            <button
              type="button"
              data-testid="chat-workspace-default"
              onClick={handleSelectDefaultWorkspace}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t('composer.defaultWorkspaceOption')}</span>
            </button>
            <button
              type="button"
              data-testid="chat-workspace-choose-other"
              onClick={() => void handleChooseOtherWorkspace()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t('composer.chooseOtherWorkspaceOption')}</span>
            </button>
          </div>
        )}
      </div>
    )}
  </div>

  <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden text-right">
    <div className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
      <div className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        isGatewayUsable ? 'bg-green-500/80' : 'bg-red-500/80',
      )} />
      <span className="min-w-0 truncate">
        {t('composer.gatewayStatus', {
          state: isGatewayUsable
            ? t('composer.gatewayConnected')
            : gatewayStatus.state === 'running'
              ? t('composer.gatewayStarting')
              : gatewayStatus.state,
          port: gatewayStatus.port,
          pid: gatewayStatus.pid ?? '',
        })}
      </span>
      {chatComposerStatusComponents.map((Component, index) => (
        <Component key={`${index}`} gatewayStatus={gatewayStatus} />
      ))}
    </div>
    {hasFailedAttachments && (
      <Button
        variant="link"
        size="sm"
        className="h-auto shrink-0 p-0 text-tiny"
        onClick={() => {
          setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
          void pickFiles();
        }}
      >
        {t('composer.retryFailedAttachments')}
      </Button>
    )}
  </div>
</div>
```

- [ ] **Step 6: Run chat input tests**

Run:

```bash
pnpm vitest run tests/unit/chat-input.test.tsx
```

Expected: PASS.

---

### Task 7: Update E2E Tests For Sidebar And Workspace UI

**Files:**
- Modify: `tests/e2e/chat-new-session-date.spec.ts`
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `tests/e2e/dialog-transitions.spec.ts`
- Modify: `tests/e2e/chat-workspace-context.spec.ts`
- Modify: `tests/e2e/chat-file-changes.spec.ts`
- Test: relevant Playwright specs

- [ ] **Step 1: Replace date bucket helpers**

In E2E files that define `DEFAULT_WORKSPACE_BUCKET_SEGMENT`, replace bucket helper functions with:

```ts
const DEFAULT_WORKSPACE_GROUP_SEGMENT = '~%2F.openclaw%2Fworkspace';

function defaultWorkspaceGroupTestId(): string {
  return `workspace-session-group-${DEFAULT_WORKSPACE_GROUP_SEGMENT}`;
}

function defaultWorkspaceGroupToggleTestId(): string {
  return `workspace-session-group-toggle-${DEFAULT_WORKSPACE_GROUP_SEGMENT}`;
}
```

Use `page.getByTestId(defaultWorkspaceGroupTestId())` when locating sessions in the default workspace group.

- [ ] **Step 2: Repurpose date grouping E2E**

In `tests/e2e/chat-new-session-date.spec.ts`, rename the describe title to `ClawX chat workspace session list`. Change the first test data to include 6 sessions in the default workspace and 1 session in another workspace:

```ts
const sessions = Array.from({ length: 6 }, (_, index) => ({
  key: `agent:main:session-${nowMs - index * 60_000}`,
  displayName: `Default conversation ${index + 1}`,
  updatedAt: nowMs - index * 60_000,
})).concat({
  key: `agent:main:session-${nowMs - 10 * 60_000}`,
  displayName: 'Project conversation',
  workspacePath: '/repo/project',
  updatedAt: nowMs - 10 * 60_000,
});
```

Assert:

```ts
await expect(page.getByText('Sessions').or(page.getByText('会话列表'))).toBeVisible();
await expect(page.getByTestId(defaultWorkspaceGroupToggleTestId())).toHaveAttribute('aria-expanded', 'true');
await expect(page.getByTestId(defaultWorkspaceGroupTestId()).getByText('Default conversation 1')).toBeVisible();
await expect(page.getByTestId(defaultWorkspaceGroupTestId()).getByText('Default conversation 5')).toBeVisible();
await expect(page.getByText('Default conversation 6')).toHaveCount(0);
await page.getByTestId(`workspace-session-load-more-${DEFAULT_WORKSPACE_GROUP_SEGMENT}`).click();
await expect(page.getByTestId(defaultWorkspaceGroupTestId()).getByText('Default conversation 6')).toBeVisible();
await page.getByTestId('session-list-toggle-all').click();
await expect(page.getByTestId(defaultWorkspaceGroupToggleTestId())).toHaveAttribute('aria-expanded', 'false');
await page.getByTestId('session-list-toggle-all').click();
await expect(page.getByTestId(defaultWorkspaceGroupToggleTestId())).toHaveAttribute('aria-expanded', 'true');
```

Keep the second test, but update its assertion from the Today bucket to the default workspace group.

- [ ] **Step 3: Update workspace context E2E for composer dropdown and tags**

In `tests/e2e/chat-workspace-context.spec.ts`, replace direct workspace selector click with:

```ts
await workspaceSelector.click();
await page.getByTestId('chat-workspace-choose-other').click();
```

Replace old header assertion with:

```ts
await expect(sidePanel.getByTestId('workspace-agent-tag')).toContainText('Main');
await expect(sidePanel.getByTestId('workspace-path-tag')).toContainText('clawx-playground');
```

- [ ] **Step 4: Update chat file changes E2E workspace path assertion**

In `tests/e2e/chat-file-changes.spec.ts`, replace:

```ts
await expect(sidePanel.getByTestId('workspace-path')).toHaveText('~/.openclaw/workspace-main');
```

with:

```ts
await expect(sidePanel.getByTestId('workspace-path-tag')).toContainText('~/.openclaw/workspace-main');
await expect(sidePanel.getByTestId('workspace-path-final-segment')).toHaveText('workspace-main');
```

- [ ] **Step 5: Run targeted E2E specs**

Run:

```bash
pnpm run test:e2e -- tests/e2e/chat-new-session-date.spec.ts tests/e2e/chat-workspace-context.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/dialog-transitions.spec.ts
```

Expected: PASS after Tasks 3, 5, and 6 are implemented.

---

### Task 8: Verification And Documentation Check

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Review: `README.ru-RU.md`
- Test: all targeted validation commands

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
pnpm vitest run tests/unit/session-buckets.test.ts tests/unit/sidebar-session-buckets.test.ts tests/unit/chat-input.test.tsx tests/unit/workspace-browser-body.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run file-scoped ESLint**

Run:

```bash
pnpm exec eslint package.json src/lib/relative-time.ts src/components/layout/session-buckets.ts src/components/layout/Sidebar.tsx src/components/file-preview/WorkspaceBrowserBody.tsx src/pages/Chat/ChatInput.tsx tests/unit/session-buckets.test.ts tests/unit/sidebar-session-buckets.test.ts tests/unit/chat-input.test.tsx tests/unit/workspace-browser-body.test.tsx tests/e2e/chat-new-session-date.spec.ts tests/e2e/chat-workspace-context.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/dialog-transitions.spec.ts
```

Expected: PASS. If package JSON linting is unsupported by the ESLint config, rerun without `package.json` and note that JSON parsing was validated by the package manager and tests.

- [ ] **Step 4: Run targeted E2E tests**

Run:

```bash
pnpm run test:e2e -- tests/e2e/chat-new-session-date.spec.ts tests/e2e/chat-workspace-context.spec.ts tests/e2e/chat-file-changes.spec.ts tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/dialog-transitions.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Review README files for doc sync**

Open `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md`. This change is UI-only and does not alter setup, architecture, commands, external behavior, or public APIs. Expected result: no README edits required. If any README contains screenshots or exact descriptions of date-bucket session grouping, update those references to workspace grouping with load-more behavior.

- [ ] **Step 6: Check full lint status without claiming it passes**

Run:

```bash
pnpm run lint:check
```

Expected: this may still fail on the pre-existing `src/pages/Chat/AcpToolCallCard.tsx` `react-hooks/set-state-in-effect` errors. If it fails only there and touched-file ESLint passes, report it as an unrelated existing blocker.

- [ ] **Step 7: Capture final worktree status**

Run:

```bash
git status --short
```

Expected: modified files are limited to this feature, prior approved workspace-cwd fixes, the new spec, and this plan. Do not commit.

---

## Self-Review Notes

- Spec coverage: sidebar title/collapse/load-more/group sorting/relative time/typography are covered by Tasks 2, 3, 4, and 7. Workspace browser tags are covered by Task 5. Composer dropdown/read-only chip/right-aligned gateway status are covered by Task 6. I18n is covered by Task 4. Tests and validation are covered by Tasks 1 through 8.
- Type consistency: the plan consistently uses `WorkspaceSessionGroup.sessions: Array<{ session, activityMs }>` and `formatSessionRelativeTime(timestampMs, nowMs, language)`.
- Commit policy: no commit commands are included because the repository instructions require explicit commit permission.

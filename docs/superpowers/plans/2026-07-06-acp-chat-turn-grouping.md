# ACP Chat Turn Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix ACP Chat heartbeat selection, assistant turn grouping, nested tool cards, delayed tool collapse, and replayed historical tool rendering without adding ClawX-local chat persistence.

**Architecture:** Keep the ACP reducer flat and protocol-faithful. Add a pure renderer-only grouping helper that derives user blocks and assistant turns from the flat timeline, then update the ACP timeline renderer to consume grouped display data. Strengthen heartbeat guards in the live chat store so hidden heartbeat sessions are not selected or reinserted after startup/Gateway refresh.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Playwright Electron E2E, Tailwind utility classes, `react-i18next` locale files.

**User Constraint:** Do not create commits while executing this plan unless the user explicitly asks.

---

## Scope Check

The spec covers one ACP Chat regression cluster: timeline presentation, tool-card behavior, historical replay display, and heartbeat-only session selection. These are tightly coupled through the ACP Chat page and sidebar session selection path, so one implementation plan is appropriate.

## File Structure

- Create `src/lib/acp/timeline-groups.ts`: pure display grouping helper for flat ACP timeline snapshots.
- Create `tests/unit/acp-timeline-groups.test.ts`: unit coverage for sequential grouping behavior.
- Create `src/pages/Chat/AcpAssistantTurn.tsx`: assistant-turn renderer with one Sparkles identity and one copy control.
- Modify `src/pages/Chat/AcpMessageSegment.tsx`: export clipboard helpers and assistant hover bar for reuse; keep user rendering behavior unchanged.
- Modify `src/pages/Chat/AcpTimeline.tsx`: render grouped timeline data instead of flat top-level siblings.
- Modify `src/pages/Chat/AcpToolCallCard.tsx`: add delayed auto-collapse, manual override, and data attributes for E2E verification.
- Modify `shared/i18n/locales/{en,zh,ja,ru}/chat.json`: add tool expand/collapse labels.
- Modify `src/stores/chat/session-key-utils.ts`: expose a hidden-heartbeat lookup helper.
- Modify `src/stores/chat.ts`: apply hidden-heartbeat selection guard in the live store's `loadSessions` path.
- Modify `src/pages/Chat/index.tsx`: defer eager ACP load of the default main session until session discovery has had a chance to reject heartbeat-only history.
- Modify `tests/unit/session-key-utils.test.ts`: cover hidden heartbeat lookup.
- Modify `src/stores/chat/session-actions.ts`: keep the modular session action path aligned with the live store logic.
- Modify `tests/unit/chat-session-actions.test.ts`: cover the modular hidden-heartbeat selection guard.
- Modify `tests/e2e/chat-acp-inline-timeline.spec.ts`: cover nested turn rendering, delayed collapse, manual override, replayed tool events, transcript fallback, and startup heartbeat selection.

---

### Task 1: Add Pure ACP Timeline Grouping

**Files:**
- Create: `src/lib/acp/timeline-groups.ts`
- Create: `tests/unit/acp-timeline-groups.test.ts`

- [ ] **Step 1: Write failing grouping tests**

Create `tests/unit/acp-timeline-groups.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { createEmptyAcpTimeline } from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

function timelineWithItems(items: AcpTimelineSnapshot['itemsById']): AcpTimelineSnapshot {
  return {
    ...createEmptyAcpTimeline('agent:main:session-1', 1),
    itemOrder: Object.keys(items),
    itemsById: items,
  };
}

describe('groupAcpTimelineItems', () => {
  it('groups assistant text, tool calls, and later assistant text into one assistant turn', () => {
    const groups = groupAcpTimelineItems(timelineWithItems({
      'assistant-a:0': {
        kind: 'message-segment',
        id: 'assistant-a:0',
        role: 'assistant',
        messageId: 'assistant-a',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'I will inspect.' }],
      },
      'tool:read': {
        kind: 'tool-call',
        id: 'tool:read',
        toolCallId: 'read',
        title: 'Read file',
        status: 'completed',
        outputParts: [{ kind: 'markdown', text: 'file contents' }],
        locations: [],
      },
      'assistant-a:1': {
        kind: 'message-segment',
        id: 'assistant-a:1',
        role: 'assistant',
        messageId: 'assistant-a',
        segmentIndex: 1,
        parts: [{ kind: 'markdown', text: 'The file is safe.' }],
      },
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'assistant-turn' });
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['assistant-a:0', 'tool:read', 'assistant-a:1']);
  });

  it('splits assistant turns at user message boundaries', () => {
    const groups = groupAcpTimelineItems(timelineWithItems({
      'user-a:0': {
        kind: 'message-segment',
        id: 'user-a:0',
        role: 'user',
        messageId: 'user-a',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'First question' }],
      },
      'assistant-a:0': {
        kind: 'message-segment',
        id: 'assistant-a:0',
        role: 'assistant',
        messageId: 'assistant-a',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'First answer' }],
      },
      'user-b:0': {
        kind: 'message-segment',
        id: 'user-b:0',
        role: 'user',
        messageId: 'user-b',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Second question' }],
      },
      'assistant-b:0': {
        kind: 'message-segment',
        id: 'assistant-b:0',
        role: 'assistant',
        messageId: 'assistant-b',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Second answer' }],
      },
    }));

    expect(groups.map((group) => group.kind)).toEqual(['user', 'assistant-turn', 'user', 'assistant-turn']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['assistant-a:0']);
    expect(groups[3]?.items.map((item) => item.id)).toEqual(['assistant-b:0']);
  });

  it('keeps consecutive user segments in one user display block', () => {
    const groups = groupAcpTimelineItems(timelineWithItems({
      'user-a:0': {
        kind: 'message-segment',
        id: 'user-a:0',
        role: 'user',
        messageId: 'user-a',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'First user segment' }],
      },
      'user-b:0': {
        kind: 'message-segment',
        id: 'user-b:0',
        role: 'user',
        messageId: 'user-b',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Second user segment' }],
      },
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'user' });
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['user-a:0', 'user-b:0']);
  });

  it('renders assistant-side items before the first user message instead of dropping them', () => {
    const groups = groupAcpTimelineItems(timelineWithItems({
      'thought:assistant-a': {
        kind: 'thought',
        id: 'thought:assistant-a',
        messageId: 'assistant-a',
        parts: [{ kind: 'markdown', text: 'Thinking...' }],
      },
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'assistant-turn' });
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['thought:assistant-a']);
  });

  it('does not use messageId, toolCallId, or _meta to decide grouping ownership', () => {
    const groups = groupAcpTimelineItems(timelineWithItems({
      'assistant-shared:0': {
        kind: 'message-segment',
        id: 'assistant-shared:0',
        role: 'assistant',
        messageId: 'same-message-id',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Before tool' }],
      },
      'tool:shared': {
        kind: 'tool-call',
        id: 'tool:shared',
        toolCallId: 'same-message-id',
        title: 'Tool with confusing id',
        status: 'running',
        outputParts: [],
        locations: [],
      },
      'assistant-other:0': {
        kind: 'message-segment',
        id: 'assistant-other:0',
        role: 'assistant',
        messageId: 'different-message-id',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'After tool' }],
      },
    }));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['assistant-shared:0', 'tool:shared', 'assistant-other:0']);
  });
});
```

- [ ] **Step 2: Run the failing grouping tests**

Run: `pnpm exec vitest run tests/unit/acp-timeline-groups.test.ts`

Expected: FAIL because `@/lib/acp/timeline-groups` does not exist.

- [ ] **Step 3: Add the grouping helper**

Create `src/lib/acp/timeline-groups.ts` with this content:

```ts
import type { AcpTimelineSnapshot, MessageSegmentItem, TimelineItem } from './timeline-types';

export type AcpUserDisplayGroup = {
  kind: 'user';
  id: string;
  items: MessageSegmentItem[];
};

export type AcpAssistantTurnDisplayGroup = {
  kind: 'assistant-turn';
  id: string;
  items: TimelineItem[];
};

export type AcpTimelineDisplayGroup = AcpUserDisplayGroup | AcpAssistantTurnDisplayGroup;

function isUserMessageSegment(item: TimelineItem): item is MessageSegmentItem {
  return item.kind === 'message-segment' && item.role === 'user';
}

function appendUserItem(groups: AcpTimelineDisplayGroup[], item: MessageSegmentItem): void {
  const previous = groups[groups.length - 1];
  if (previous?.kind === 'user') {
    previous.items.push(item);
    return;
  }

  groups.push({
    kind: 'user',
    id: `user-group:${item.id}`,
    items: [item],
  });
}

function appendAssistantItem(groups: AcpTimelineDisplayGroup[], item: TimelineItem): void {
  const previous = groups[groups.length - 1];
  if (previous?.kind === 'assistant-turn') {
    previous.items.push(item);
    return;
  }

  groups.push({
    kind: 'assistant-turn',
    id: `assistant-turn:${item.id}`,
    items: [item],
  });
}

export function groupAcpTimelineItems(snapshot: AcpTimelineSnapshot): AcpTimelineDisplayGroup[] {
  const groups: AcpTimelineDisplayGroup[] = [];

  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (!item) continue;

    if (isUserMessageSegment(item)) {
      appendUserItem(groups, item);
      continue;
    }

    appendAssistantItem(groups, item);
  }

  return groups;
}
```

- [ ] **Step 4: Run grouping tests until they pass**

Run: `pnpm exec vitest run tests/unit/acp-timeline-groups.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint the diff**

Run: `git diff -- src/lib/acp/timeline-groups.ts tests/unit/acp-timeline-groups.test.ts`

Expected: diff only contains the new grouping helper and its tests.

---

### Task 2: Render Assistant Turns From Grouped Timeline Data

**Files:**
- Create: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Modify: `src/pages/Chat/AcpTimeline.tsx`

- [ ] **Step 1: Export reusable assistant copy helpers**

In `src/pages/Chat/AcpMessageSegment.tsx`, change these function declarations:

```ts
function clipboardTextForParts(parts: RenderPart[]): string {
```

to:

```ts
export function clipboardTextForParts(parts: RenderPart[]): string {
```

Then change:

```ts
function AcpAssistantHoverBar({ text }: { text: string }) {
```

to:

```ts
export function AcpAssistantHoverBar({ text }: { text: string }) {
```

- [ ] **Step 2: Add the assistant turn renderer**

Create `src/pages/Chat/AcpAssistantTurn.tsx` with this content:

```tsx
import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { AcpAssistantTurnDisplayGroup } from '@/lib/acp/timeline-groups';
import { cn } from '@/lib/utils';
import { AcpMessageSegment, AcpRenderPart, AcpAssistantHoverBar, clipboardTextForParts } from './AcpMessageSegment';
import { AcpPermissionCard } from './AcpPermissionCard';
import { AcpPlanItem } from './AcpPlanItem';
import { AcpThoughtBlock } from './AcpThoughtBlock';
import { AcpToolCallCard } from './AcpToolCallCard';

function assistantTurnClipboardText(group: AcpAssistantTurnDisplayGroup): string {
  return group.items
    .filter((item) => item.kind === 'message-segment' && item.role === 'assistant')
    .map((item) => clipboardTextForParts(item.parts))
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

export function AcpAssistantTurn({
  group,
  onPermissionSelect,
}: {
  group: AcpAssistantTurnDisplayGroup;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
}) {
  const clipboardText = useMemo(() => assistantTurnClipboardText(group), [group]);

  return (
    <div data-testid="acp-assistant-turn" className="group flex w-full justify-start gap-3">
      <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
          <Sparkles className="h-4 w-4" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        {group.items.map((item) => {
          if (item.kind === 'message-segment') {
            if (item.role === 'user') return <AcpMessageSegment key={item.id} item={item} />;
            return (
              <div key={item.id} data-acp-item-id={item.id} data-testid="acp-assistant-message" className="flex min-w-0 flex-col gap-2">
                {item.parts.map((part, index) => (
                  <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone="assistant" />
                ))}
              </div>
            );
          }

          if (item.kind === 'tool-call') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpToolCallCard item={item} />
              </div>
            );
          }

          if (item.kind === 'permission') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpPermissionCard item={item} onSelect={onPermissionSelect} />
              </div>
            );
          }

          if (item.kind === 'thought') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpThoughtBlock item={item} />
              </div>
            );
          }

          if (item.kind === 'plan') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpPlanItem item={item} />
              </div>
            );
          }

          return null;
        })}

        {clipboardText.trim().length > 0 && (
          <div className={cn('w-full')}>
            <AcpAssistantHoverBar text={clipboardText} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace flat ACP timeline rendering with grouped rendering**

Replace the full contents of `src/pages/Chat/AcpTimeline.tsx` with:

```tsx
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { AcpAssistantTurn } from './AcpAssistantTurn';
import { AcpErrorBanner } from './AcpErrorBanner';
import { AcpMessageSegment } from './AcpMessageSegment';

export function AcpTimeline({
  snapshot,
  error,
  errorKind = 'load',
  onDismissError,
  onPermissionSelect,
}: {
  snapshot: AcpTimelineSnapshot;
  error?: string | null;
  errorKind?: 'load' | 'prompt';
  onDismissError?: () => void;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
}) {
  const groups = groupAcpTimelineItems(snapshot);

  return (
    <div data-testid="acp-chat-timeline" className="flex flex-col gap-4">
      {error && <AcpErrorBanner message={error} kind={errorKind} onDismiss={onDismissError} />}
      {groups.map((group) => {
        if (group.kind === 'user') {
          return (
            <div key={group.id} data-acp-group-id={group.id} className="flex flex-col gap-3">
              {group.items.map((item) => (
                <div key={item.id} data-acp-item-id={item.id}>
                  <AcpMessageSegment item={item} />
                </div>
              ))}
            </div>
          );
        }

        return (
          <div key={group.id} data-acp-group-id={group.id}>
            <AcpAssistantTurn group={group} onPermissionSelect={onPermissionSelect} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck for the new render structure**

Run: `pnpm run typecheck`

Expected: PASS. If TypeScript narrows `group.items` too broadly inside `AcpAssistantTurn`, keep the helper's public group item type as `TimelineItem[]` and use explicit `item.kind` checks as shown above.

- [ ] **Step 5: Run existing ACP reducer and grouping tests**

Run: `pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-timeline-groups.test.ts`

Expected: PASS.

- [ ] **Step 6: Checkpoint the diff**

Run: `git diff -- src/lib/acp/timeline-groups.ts src/pages/Chat/AcpAssistantTurn.tsx src/pages/Chat/AcpMessageSegment.tsx src/pages/Chat/AcpTimeline.tsx tests/unit/acp-timeline-groups.test.ts`

Expected: grouped timeline changes only; no reducer persistence changes.

---

### Task 3: Add Delayed Tool Auto-Collapse With Manual Override

**Files:**
- Modify: `src/pages/Chat/AcpToolCallCard.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

- [ ] **Step 1: Replace the tool card implementation**

Replace `src/pages/Chat/AcpToolCallCard.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, Wrench, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpRenderPart } from './AcpMessageSegment';

const TOOL_AUTO_COLLAPSE_DELAY_MS = 1_000;

function statusLabelKey(status: ToolCallItem['status']): string {
  return `acp.${status}`;
}

function statusClasses(status: ToolCallItem['status']): string {
  if (status === 'running') return 'text-blue-700 dark:text-blue-400 bg-black/5 dark:bg-white/10';
  if (status === 'completed') return 'text-green-700 dark:text-green-400 bg-black/5 dark:bg-white/10';
  if (status === 'failed') return 'text-red-700 dark:text-red-400 bg-black/5 dark:bg-white/10';
  return 'text-amber-700 dark:text-amber-400 bg-black/5 dark:bg-white/10';
}

function StatusIcon({ status }: { status: ToolCallItem['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === 'failed') return <XCircle className="h-4 w-4" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4" aria-hidden="true" />;
}

function AcpToolOutputPart({ part }: { part: RenderPart }) {
  if (part.kind === 'markdown') {
    return (
      <pre
        data-testid="acp-tool-output-pre"
        className="max-h-96 overflow-auto whitespace-pre rounded-xl border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
      >
        {part.text}
      </pre>
    );
  }

  return <AcpRenderPart part={part} tone="process" />;
}

export function AcpToolCallCard({ item }: { item: ToolCallItem }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(item.status !== 'completed');
  const [manualOverride, setManualOverride] = useState(false);
  const hasDetails = Boolean(item.error) || item.outputParts.length > 0;
  const lastToolCallIdRef = useRef(item.toolCallId);

  useEffect(() => {
    if (lastToolCallIdRef.current === item.toolCallId) return;
    lastToolCallIdRef.current = item.toolCallId;
    setExpanded(item.status !== 'completed');
    setManualOverride(false);
  }, [item.status, item.toolCallId]);

  useEffect(() => {
    if (manualOverride) return;
    if (item.status !== 'completed') {
      setExpanded(true);
      return;
    }

    const timer = window.setTimeout(() => setExpanded(false), TOOL_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [item.status, manualOverride]);

  const toggleLabel = expanded ? t('acp.collapseTool') : t('acp.expandTool');

  return (
    <div
      data-testid="acp-tool-call-card"
      data-expanded={expanded ? 'true' : 'false'}
      className="rounded-2xl border border-black/10 bg-surface-modal px-4 py-3 shadow-sm dark:border-white/10"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          data-testid="acp-tool-toggle"
          onClick={() => {
            setManualOverride(true);
            setExpanded((value) => !value);
          }}
          disabled={!hasDetails}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/10"
        >
          {hasDetails ? (
            expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</span>
        </button>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide', statusClasses(item.status))}>
          <StatusIcon status={item.status} />
          {t(statusLabelKey(item.status))}
        </span>
      </div>

      {hasDetails && (
        <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="min-h-0 overflow-hidden" aria-hidden={!expanded}>
            {item.error && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {item.error}
              </div>
            )}

            {item.outputParts.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {item.outputParts.map((part, index) => (
                  <AcpToolOutputPart key={`${part.kind}:${index}`} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add English labels**

In `shared/i18n/locales/en/chat.json`, inside the `acp` object, change:

```json
        "copy": "Copy response",
        "copied": "Copied"
```

to:

```json
        "copy": "Copy response",
        "copied": "Copied",
        "expandTool": "Expand tool result",
        "collapseTool": "Collapse tool result"
```

- [ ] **Step 3: Add Chinese labels**

In `shared/i18n/locales/zh/chat.json`, add these keys inside `acp` after `copied`:

```json
        "expandTool": "展开工具结果",
        "collapseTool": "折叠工具结果"
```

- [ ] **Step 4: Add Japanese labels**

In `shared/i18n/locales/ja/chat.json`, add these keys inside `acp` after `copied`:

```json
        "expandTool": "ツール結果を展開",
        "collapseTool": "ツール結果を折りたたむ"
```

- [ ] **Step 5: Add Russian labels**

In `shared/i18n/locales/ru/chat.json`, add these keys inside `acp` after `copied`:

```json
        "expandTool": "Развернуть результат инструмента",
        "collapseTool": "Свернуть результат инструмента"
```

- [ ] **Step 6: Run typecheck and the ACP E2E smoke test target later in Task 5**

Run: `pnpm run typecheck`

Expected: PASS. The existing E2E test `preserves ACP tool output newlines and indentation` will need a small update in Task 5 so it does not race the completed-card auto-collapse.

- [ ] **Step 7: Checkpoint the diff**

Run: `git diff -- src/pages/Chat/AcpToolCallCard.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json`

Expected: tool card state/labels only.

---

### Task 4: Guard Heartbeat-Only Sessions At Selection Boundaries

**Files:**
- Modify: `src/stores/chat/session-key-utils.ts`
- Modify: `tests/unit/session-key-utils.test.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/stores/chat/session-actions.ts`
- Modify: `tests/unit/chat-session-actions.test.ts`

- [ ] **Step 1: Add hidden-heartbeat lookup tests**

In `tests/unit/session-key-utils.test.ts`, update the import block to include `findHiddenOpenClawHeartbeatSession`:

```ts
import {
  findHiddenOpenClawHeartbeatSession,
  isChannelSessionKey,
  isClawXDesktopSessionKey,
  isPlaceholderChannelSession,
  shouldIncludeSessionInSidebarList,
} from '@/stores/chat/session-key-utils';
```

Then append these tests before the final `});`:

```ts
  it('finds a hidden heartbeat session by current key', () => {
    const sessions: ChatSession[] = [
      {
        key: 'agent:main:main',
        displayName: 'ClawX',
        lastMessagePreview: '[OpenClaw heartbeat poll]',
      },
      {
        key: 'agent:main:session-1710000000000',
        displayName: 'ClawX',
        lastMessagePreview: 'Summarize the repository structure',
      },
    ];

    expect(findHiddenOpenClawHeartbeatSession('agent:main:main', sessions)?.key).toBe('agent:main:main');
    expect(findHiddenOpenClawHeartbeatSession('agent:main:session-1710000000000', sessions)).toBeNull();
  });

  it('does not treat missing metadata as proof of a hidden heartbeat session', () => {
    const sessions: ChatSession[] = [{ key: 'agent:main:main', displayName: 'ClawX' }];

    expect(findHiddenOpenClawHeartbeatSession('agent:main:main', sessions)).toBeNull();
  });
```

- [ ] **Step 2: Run the failing session-key tests**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts`

Expected: FAIL because `findHiddenOpenClawHeartbeatSession` is not exported yet.

- [ ] **Step 3: Export the hidden-heartbeat lookup helper**

In `src/stores/chat/session-key-utils.ts`, add this function after `isOpenClawHeartbeatOnlySession`:

```ts
export function findHiddenOpenClawHeartbeatSession(sessionKey: string, sessions: ChatSession[]): ChatSession | null {
  const session = sessions.find((candidate) => candidate.key === sessionKey);
  return session && isOpenClawHeartbeatOnlySession(session) ? session : null;
}
```

- [ ] **Step 4: Run the session-key tests until they pass**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts`

Expected: PASS.

- [ ] **Step 5: Guard hidden current sessions in the live store**

In `src/stores/chat.ts`, change the import from `session-key-utils` near the top from:

```ts
import { isClawXDesktopSessionKey, shouldIncludeSessionInSidebarList } from './chat/session-key-utils';
```

to:

```ts
import { findHiddenOpenClawHeartbeatSession, isClawXDesktopSessionKey, shouldIncludeSessionInSidebarList } from './chat/session-key-utils';
```

In the `loadSessions` implementation, replace this block:

```ts
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
            status: parseSessionStatus(s.status),
            hasActiveRun: typeof s.hasActiveRun === 'boolean' ? s.hasActiveRun : undefined,
            channel: s.lastChannel ? String(s.lastChannel) : undefined,
          })).filter((s: ChatSession) => shouldIncludeSessionInSidebarList(s));
```

with:

```ts
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const normalizedSessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
            status: parseSessionStatus(s.status),
            hasActiveRun: typeof s.hasActiveRun === 'boolean' ? s.hasActiveRun : undefined,
            channel: s.lastChannel ? String(s.lastChannel) : undefined,
          }));
          const sessions: ChatSession[] = normalizedSessions.filter((s: ChatSession) => shouldIncludeSessionInSidebarList(s));
```

Then, immediately after:

```ts
          const { currentSessionKey, sessions: localSessions } = get();
          let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
```

insert:

```ts
          const hiddenCurrentSession = findHiddenOpenClawHeartbeatSession(nextSessionKey, normalizedSessions);
          if (hiddenCurrentSession) {
            const prefix = getCanonicalPrefixFromSessionKey(nextSessionKey)
              ?? getCanonicalPrefixFromSessions(sessions)
              ?? DEFAULT_CANONICAL_PREFIX;
            nextSessionKey = `${prefix}:session-${Date.now()}`;
          }
```

This makes startup/restart select a fresh empty desktop session when the current key is proven to be heartbeat-only.

- [ ] **Step 6: Defer eager default ACP load in the Chat page**

In `src/pages/Chat/index.tsx`, add this import:

```ts
import { DEFAULT_SESSION_KEY } from '@shared/chat/types';
```

Add a store selector near the existing `currentSessionKey` selector:

```ts
  const sessions = useChatStore((s) => s.sessions);
```

Then replace the first lines of the ACP load effect:

```ts
  useEffect(() => {
    if (!currentSessionKey || !cwd) return;
```

with:

```ts
  useEffect(() => {
    if (!currentSessionKey || !cwd) return;
    if (currentSessionKey === DEFAULT_SESSION_KEY && sessions.length === 0 && acpActiveSessionKey == null) return;
```

Update the effect dependency list from:

```ts
  }, [currentSessionKey, cwd, loadAcpSession]);
```

to:

```ts
  }, [acpActiveSessionKey, currentSessionKey, cwd, loadAcpSession, sessions.length]);
```

This prevents the page from loading `agent:main:main` before `sessions.list` can filter or replace a heartbeat-only default session.

- [ ] **Step 7: Keep the modular session action path aligned**

In `src/stores/chat/session-actions.ts`, update its import to include `findHiddenOpenClawHeartbeatSession`:

```ts
import { findHiddenOpenClawHeartbeatSession, isClawXDesktopSessionKey, shouldIncludeSessionInSidebarList } from './session-key-utils';
```

Replace the raw session mapping block:

```ts
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
            status: parseSessionStatus(s.status),
            hasActiveRun: typeof s.hasActiveRun === 'boolean' ? s.hasActiveRun : undefined,
            channel: s.lastChannel ? String(s.lastChannel) : undefined,
          })).filter((s: ChatSession) => shouldIncludeSessionInSidebarList(s));
```

with:

```ts
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const normalizedSessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
            status: parseSessionStatus(s.status),
            hasActiveRun: typeof s.hasActiveRun === 'boolean' ? s.hasActiveRun : undefined,
            channel: s.lastChannel ? String(s.lastChannel) : undefined,
          }));
          const sessions: ChatSession[] = normalizedSessions.filter((s: ChatSession) => shouldIncludeSessionInSidebarList(s));
```

Then insert this block after `let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;`:

```ts
          const hiddenCurrentSession = findHiddenOpenClawHeartbeatSession(nextSessionKey, normalizedSessions);
          if (hiddenCurrentSession) {
            const prefix = getCanonicalPrefixFromSessions(sessions) ?? DEFAULT_CANONICAL_PREFIX;
            nextSessionKey = `${prefix}:session-${Date.now()}`;
          }
```

- [ ] **Step 8: Add a modular session-action regression test**

In `tests/unit/chat-session-actions.test.ts`, extend the `ChatLikeState['sessions']` type so test sessions can include heartbeat metadata:

```ts
  sessions: Array<{ key: string; label?: string; displayName?: string; derivedTitle?: string; lastMessagePreview?: string; updatedAt?: number; status?: string; hasActiveRun?: boolean }>;
```

Then append this test before the final `});`:

```ts
  it('moves away from a heartbeat-only current session during sessions load', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      messages: [],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    gatewayRpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [{
          key: 'agent:main:main',
          displayName: 'ClawX',
          lastMessagePreview: '[OpenClaw heartbeat poll]',
          updatedAt: 1773281700000,
        }],
      },
    });

    await actions.loadSessions();

    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(next.sessions.map((session) => session.key)).toEqual(['agent:main:session-1711111111111']);
    expect(next.sessions.find((session) => session.key === 'agent:main:main')).toBeUndefined();
    nowSpy.mockRestore();
  });
```

- [ ] **Step 9: Run heartbeat/session tests**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts tests/unit/chat-session-actions.test.ts`

Expected: PASS.

- [ ] **Step 10: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 11: Checkpoint the diff**

Run: `git diff -- src/stores/chat/session-key-utils.ts src/stores/chat.ts src/stores/chat/session-actions.ts src/pages/Chat/index.tsx tests/unit/session-key-utils.test.ts tests/unit/chat-session-actions.test.ts`

Expected: heartbeat selection guards only; no transcript deletion or OpenClaw behavior changes.

---

### Task 5: Update ACP Chat E2E Coverage

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`

- [ ] **Step 1: Add a replay-load helper**

In `tests/e2e/chat-acp-inline-timeline.spec.ts`, after `installAcpChatMocks`, add:

```ts
async function installAcpLoadReplayMock(app: ElectronApplication, updates: AcpSessionUpdate[]) {
  await app.evaluate(async ({ app: _app }, replayUpdates) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        for (const update of replayUpdates as AcpSessionUpdate[]) {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('chat:acp-session-update', {
              sessionKey: MAIN_SESSION_KEY,
              generation: 1,
              notification: {
                sessionId: MAIN_SESSION_KEY,
                update,
              },
            });
          }
        }
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, updates);
}
```

- [ ] **Step 2: Update the existing tool formatting test to avoid auto-collapse race**

In the existing test `preserves ACP tool output newlines and indentation`, change the emitted tool status from:

```ts
          status: 'completed',
```

to:

```ts
          status: 'in_progress',
```

The reducer normalizes `in_progress` to `running`, so output stays expanded while this test checks exact whitespace.

- [ ] **Step 3: Add grouped turn and nested tool E2E test**

Append this test before the closing `});` of the describe block:

```ts
  test('groups assistant text and tool calls into one assistant turn', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: { type: 'text', text: 'I will inspect the file.' },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-grouped',
          title: 'Read grouped file',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'grouped output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: { type: 'text', text: ' The file is safe.' },
        },
      ]);

      await expect(page.getByTestId('acp-assistant-turn')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toHaveCount(1);
      await expect(page.getByTestId('acp-assistant-copy')).toHaveCount(1);
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read grouped file');
      await expect.poll(() => page.getByTestId('acp-tool-call-card').evaluate((element) => Boolean(element.closest('[data-testid="acp-assistant-turn"]')))).toBe(true);
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('I will inspect the file.');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('The file is safe.');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 4: Add auto-collapse and manual override E2E test**

Append this test before the closing `});` of the describe block:

```ts
  test('auto-collapses completed tool cards and respects manual override', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'collapse-tool',
          title: 'Collapsible tool',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toHaveAttribute('data-expanded', 'true', { timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      await expect(card).toHaveAttribute('data-expanded', 'false', { timeout: 30_000 });

      await page.getByTestId('acp-tool-toggle').click();
      await expect(card).toHaveAttribute('data-expanded', 'true');

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output after override' } }],
          locations: [],
        },
      ]);

      await page.waitForTimeout(1_200);
      await expect(card).toHaveAttribute('data-expanded', 'true');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 5: Add ledger-style replay E2E test**

Append this test before the closing `});` of the describe block:

```ts
  test('renders ledger-style replayed ACP tool events as historical tool cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-user',
          content: [{ type: 'text', text: 'Replay the tool call' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool',
          title: 'Historical tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'historical output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'history-assistant',
          content: [{ type: 'text', text: 'Historical answer' }],
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Historical tool');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Historical answer');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 6: Add transcript fallback E2E test**

Append this test before the closing `});` of the describe block:

```ts
  test('does not synthesize tool cards for transcript fallback text replay', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Old transcript prompt' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Transcript text mentions tool_call but has no structured tool event.' },
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Transcript text mentions tool_call')).toBeVisible();
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 7: Add heartbeat startup E2E test**

Append this test before the closing `});` of the describe block:

```ts
  test('starts on a new empty chat instead of selecting a heartbeat-only ClawX session', async ({ launchElectronApp }) => {
    const now = 1711111111111;
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'ClawX',
                lastMessagePreview: '[OpenClaw heartbeat poll]',
                updatedAt: new Date(now).toISOString(),
              }],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`)).toHaveCount(0);
      await expect(page.getByText('[OpenClaw heartbeat poll]')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 8: Run the targeted E2E spec**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: PASS. If the replay helper emits before the renderer subscribes, move the `BrowserWindow.getAllWindows().send(...)` loop into `queueMicrotask(() => { ... })` inside the mocked `loadAcpSession` handler and rerun.

- [ ] **Step 9: Checkpoint the E2E diff**

Run: `git diff -- tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: only ACP Chat inline timeline tests and helpers changed.

---

### Task 6: Validation And Documentation Review

**Files:**
- Read: `README.md`
- Read: `README.zh-CN.md`
- Read: `README.ja-JP.md`
- Modify only if the visible behavior requires a troubleshooting note.

- [ ] **Step 1: Run focused unit tests**

Run: `pnpm exec vitest run tests/unit/acp-timeline-groups.test.ts tests/unit/acp-reducer.test.ts tests/unit/session-key-utils.test.ts tests/unit/chat-session-actions.test.ts`

Expected: PASS.

- [ ] **Step 2: Run targeted E2E**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run: `pnpm run build:vite`

Expected: PASS. Existing Vite warnings are acceptable if they match the current baseline.

- [ ] **Step 5: Review README files**

Read `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for any Chat history wording that conflicts with the new explicit behavior:

```text
Ledger-backed ACP sessions can replay historical tool cards.
Transcript fallback sessions do not reconstruct historical tool cards.
```

Expected: no README change unless one of those files already documents historical tool-card behavior incorrectly.

- [ ] **Step 6: Run whitespace diff check**

Run: `git diff --check`

Expected: no trailing whitespace or conflict markers.

- [ ] **Step 7: Summarize final diff without committing**

Run: `git status --short`

Expected: modified/new files are limited to the implementation, tests, i18n, and the spec/plan docs. Do not commit unless the user explicitly asks.

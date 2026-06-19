# OpenClaw Chat P0/P1 Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the P0/P1 OpenClaw Chat protocol/rendering gaps in ClawX: assistant phases, thinking, live tools, command output, patch summaries, approval updates, lifecycle cleanup, heartbeat filtering, and composer-adjacent running status.

**Architecture:** Keep Main as the Gateway transport owner and continue consuming raw `gateway:agent-event` payloads through the existing host-event path. Expand `src/chat-core/openclaw-port` into a phase-aware semantic core, then render stable `VisibleChatItem` values through ClawX's existing React components and design tokens.

**Tech Stack:** Electron Main/Renderer IPC, React 19, TypeScript, Zustand, Vitest, Playwright Electron E2E, `react-i18next`, existing ClawX `hostApi`, `api-client`, and `hostEvents`.

---

## Scope Check

This plan covers one dependent subsystem: the Chat surface's OpenClaw event semantics and rendering pipeline. The work touches reducers, selectors, extraction helpers, React display components, E2E coverage, and comms validation because each layer depends on the previous one. Canvas, audio/voice, OpenClaw `item` streams, OpenClaw `plan` streams, and the old execution graph UI are out of scope.

## File Structure Map

Create:

- `src/chat-core/openclaw-port/message-extraction.ts` - assistant phase extraction, thinking extraction, heartbeat/internal-text filtering, and display text helpers.
- `src/pages/Chat/ThinkingBlock.tsx` - muted collapsible reasoning display.
- `src/pages/Chat/CommandCard.tsx` - command output summary display.
- `src/pages/Chat/PatchCard.tsx` - patch summary display.
- `tests/unit/openclaw-chat-message-extraction.test.ts` - extraction helper coverage.

Modify:

- `src/chat-core/openclaw-port/types.ts` - structured live state and new visible item types.
- `src/chat-core/openclaw-port/actions.ts` - semantic actions for assistant, thinking, tool, command, patch, lifecycle, approval upsert, and session operation.
- `src/chat-core/openclaw-port/state.ts` - initial structured live/runtime state.
- `src/chat-core/openclaw-port/events.ts` - raw OpenClaw stream to semantic action mapping.
- `src/chat-core/openclaw-port/reducer.ts` - state transitions, live interleaving, terminal cleanup, and dedup/upsert behavior.
- `src/chat-core/openclaw-port/selectors.ts` - build stable visible items from history, queue, live output, and runtime state.
- `src/chat-core/openclaw-port/tool-cards.ts` - accept live tool card shape without raw-output affordances.
- `src/pages/Chat/MessageList.tsx` - render new visible item kinds.
- `src/pages/Chat/StreamingGroup.tsx` - render live stream media and phase-aware text through `ChatMessage`.
- `src/pages/Chat/index.tsx` - move running pulse to the composer top-left with the `AI 回复中` label.
- `shared/i18n/locales/en/chat.json`
- `shared/i18n/locales/zh/chat.json`
- `shared/i18n/locales/ja/chat.json`
- `shared/i18n/locales/ru/chat.json`
- `tests/unit/openclaw-chat-core-reducer.test.ts`
- `tests/e2e/chat-openclaw-core.spec.ts`
- `harness/specs/tasks/openclaw-chat-core-port.md`

Do not modify:

- `/Users/zhuoxu/workspace/openclaw/**`
- Renderer direct IPC usage outside `src/lib/host-api.ts`, `src/lib/api-client.ts`, and `src/lib/host-events.ts`
- Renderer direct Gateway HTTP or WebSocket code

## Task 1: Message Extraction Helpers

**Files:**

- Create: `src/chat-core/openclaw-port/message-extraction.ts`
- Create: `tests/unit/openclaw-chat-message-extraction.test.ts`

- [ ] **Step 1: Write the failing extraction tests**

Create `tests/unit/openclaw-chat-message-extraction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  extractAssistantDisplayParts,
  extractAssistantVisibleText,
  extractThinkingText,
  isHiddenAssistantMessage,
  isHiddenStreamText,
  stripHeartbeatTokenForDisplay,
} from '@/chat-core/openclaw-port/message-extraction';

describe('OpenClaw chat message extraction', () => {
  it('prefers final_answer and keeps commentary and thinking separate', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should inspect the file first.' },
        {
          type: 'text',
          text: 'I will inspect the file.',
          textSignature: JSON.stringify({ v: 1, id: 'comment-1', phase: 'commentary' }),
        },
        {
          type: 'text',
          text: 'The file is valid.',
          textSignature: JSON.stringify({ v: 1, id: 'final-1', phase: 'final_answer' }),
        },
      ],
    };

    expect(extractAssistantVisibleText(message)).toBe('The file is valid.');
    expect(extractThinkingText(message)).toBe('I should inspect the file first.');
    expect(extractAssistantDisplayParts(message)).toEqual({
      visibleText: 'The file is valid.',
      commentaryText: 'I will inspect the file.',
      thinkingText: 'I should inspect the file first.',
    });
  });

  it('extracts legacy think tags without leaking them into visible text', () => {
    const message = {
      role: 'assistant',
      content: '<think>Check constraints.</think>\nFinal reply.',
    };

    expect(extractThinkingText(message)).toBe('Check constraints.');
    expect(extractAssistantVisibleText(message)).toBe('Final reply.');
  });

  it('keeps legacy unphased assistant text visible when no final_answer exists', () => {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Legacy reply.' }],
    };

    expect(extractAssistantVisibleText(message)).toBe('Legacy reply.');
  });

  it('filters heartbeat and no-reply assistant messages', () => {
    expect(stripHeartbeatTokenForDisplay('HEARTBEAT_OK')).toEqual({ shouldSkip: true, text: '' });
    expect(isHiddenStreamText('NO_REPLY')).toBe(true);
    expect(isHiddenAssistantMessage({ role: 'assistant', content: 'HEARTBEAT_OK' })).toBe(true);
    expect(isHiddenAssistantMessage({
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'still hidden heartbeat reasoning' }],
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the extraction tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts
```

Expected: FAIL with an import error for `message-extraction`.

- [ ] **Step 3: Implement the extraction module**

Create `src/chat-core/openclaw-port/message-extraction.ts`:

```ts
import type { RawOpenClawMessage } from './types';

export type AssistantPhase = 'commentary' | 'final_answer';

const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
const INTERNAL_SENTINEL_PATTERN = /^(?:HEARTBEAT_OK|NO_REPLY)\s*$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeAssistantPhase(value: unknown): AssistantPhase | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
}

function parseAssistantTextSignature(value: unknown): { id?: string; phase?: AssistantPhase } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!value.startsWith('{')) return { id: value };
  try {
    const parsed = JSON.parse(value) as { v?: unknown; id?: unknown; phase?: unknown };
    if (parsed.v !== 1) return null;
    const phase = normalizeAssistantPhase(parsed.phase);
    return {
      ...(typeof parsed.id === 'string' && parsed.id.trim() ? { id: parsed.id } : {}),
      ...(phase ? { phase } : {}),
    };
  } catch {
    return null;
  }
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractRawText(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  const record = asRecord(message);
  if (!record) return undefined;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (!Array.isArray(record.content)) return undefined;
  const parts = record.content.flatMap((part) => {
    const partRecord = asRecord(part);
    return partRecord?.type === 'text' && typeof partRecord.text === 'string'
      ? [partRecord.text]
      : [];
  });
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function extractAssistantTextForPhase(message: unknown, phase?: AssistantPhase): string | undefined {
  const record = asRecord(message);
  if (!record) return undefined;
  const directPhase = normalizeAssistantPhase(record.phase);
  const include = (resolved?: AssistantPhase) => (phase ? resolved === phase : resolved === undefined);

  if (typeof record.text === 'string') {
    return include(directPhase) ? stripThinkTags(record.text) || undefined : undefined;
  }
  if (typeof record.content === 'string') {
    return include(directPhase) ? stripThinkTags(record.content) || undefined : undefined;
  }
  if (!Array.isArray(record.content)) return undefined;

  const hasExplicitPhase = record.content.some((part) => {
    const partRecord = asRecord(part);
    return partRecord?.type === 'text' && parseAssistantTextSignature(partRecord.textSignature)?.phase;
  });
  if (!phase && hasExplicitPhase) return undefined;

  const parts = record.content.flatMap((part) => {
    const partRecord = asRecord(part);
    if (partRecord?.type !== 'text' || typeof partRecord.text !== 'string') return [];
    const signature = parseAssistantTextSignature(partRecord.textSignature);
    const resolved = signature?.phase ?? (hasExplicitPhase ? undefined : directPhase);
    if (!include(resolved)) return [];
    const stripped = stripThinkTags(partRecord.text);
    return stripped ? [stripped] : [];
  });

  return parts.length > 0 ? parts.join('\n').trim() || undefined : undefined;
}

export function extractAssistantVisibleText(message: unknown): string | undefined {
  return extractAssistantTextForPhase(message, 'final_answer') ?? extractAssistantTextForPhase(message);
}

export function extractAssistantCommentaryText(message: unknown): string | undefined {
  return extractAssistantTextForPhase(message, 'commentary');
}

export function extractThinkingText(message: unknown): string | undefined {
  const record = asRecord(message);
  const parts: string[] = [];
  const content = record?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const partRecord = asRecord(part);
      if (partRecord?.type === 'thinking' && typeof partRecord.thinking === 'string') {
        const trimmed = partRecord.thinking.trim();
        if (trimmed) parts.push(trimmed);
      }
    }
  }
  if (parts.length > 0) return parts.join('\n');

  const raw = extractRawText(message);
  if (!raw) return undefined;
  const matches = [...raw.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi)];
  const extracted = matches.map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
  return extracted.length > 0 ? extracted.join('\n') : undefined;
}

export function extractAssistantDisplayParts(message: unknown): {
  visibleText?: string;
  commentaryText?: string;
  thinkingText?: string;
} {
  return {
    visibleText: extractAssistantVisibleText(message),
    commentaryText: extractAssistantCommentaryText(message),
    thinkingText: extractThinkingText(message),
  };
}

export function stripHeartbeatTokenForDisplay(raw: string): { shouldSkip: boolean; text: string } {
  let text = raw.trim();
  if (!text) return { shouldSkip: true, text: '' };
  if (!text.includes(HEARTBEAT_TOKEN)) return { shouldSkip: false, text };
  text = text.replaceAll(HEARTBEAT_TOKEN, '').trim();
  return { shouldSkip: !text || text.length <= 300, text };
}

export function isHiddenStreamText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (INTERNAL_SENTINEL_PATTERN.test(trimmed)) return true;
  return stripHeartbeatTokenForDisplay(trimmed).shouldSkip;
}

export function isHiddenAssistantMessage(message: RawOpenClawMessage | Record<string, unknown>): boolean {
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  if (role !== 'assistant') return false;
  const visible = extractAssistantVisibleText(message);
  if (visible && !isHiddenStreamText(visible)) return false;
  const thinking = extractThinkingText(message);
  if (thinking && !visible) return true;
  return true;
}
```

- [ ] **Step 4: Run extraction tests and commit**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/chat-core/openclaw-port/message-extraction.ts tests/unit/openclaw-chat-message-extraction.test.ts
git commit -m "feat(chat): add OpenClaw message extraction helpers"
```

## Task 2: Assistant, Thinking, and Lifecycle Core State

**Files:**

- Modify: `src/chat-core/openclaw-port/types.ts`
- Modify: `src/chat-core/openclaw-port/actions.ts`
- Modify: `src/chat-core/openclaw-port/state.ts`
- Modify: `src/chat-core/openclaw-port/events.ts`
- Modify: `src/chat-core/openclaw-port/reducer.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Add failing reducer tests for assistant phase, thinking, and lifecycle terminal cleanup**

Append these tests to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('keeps assistant commentary separate from final answer stream', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-phase',
      stream: 'assistant',
      ts: 10,
      data: { text: 'Inspecting files.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-phase',
      stream: 'assistant',
      ts: 20,
      data: { text: 'Final answer.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);

    expect(state.live.currentAssistant?.phase).toBe('final_answer');
    expect(state.live.assistantSegments).toEqual([
      expect.objectContaining({ text: 'Inspecting files.', phase: 'commentary' }),
    ]);
    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      text: 'Final answer.',
      phase: 'final_answer',
    }));
  });

  it('renders thinking stream as a separate visible item', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-thinking',
      stream: 'thinking',
      ts: 30,
      data: { text: 'Reason about constraints.' },
    }).reduce(chatCoreReducer, createInitialChatCoreState({ sessionKey: 'agent:main:main' }));

    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      text: 'Reason about constraints.',
      runId: 'run-thinking',
    }));
  });

  it('treats aborted lifecycle as interrupted and clears abortable state', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-abort',
      stream: 'lifecycle',
      data: { phase: 'start' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-abort',
      stream: 'lifecycle',
      data: {
        phase: 'aborted',
        endedAt: 1234,
        stopReason: 'user_abort',
        livenessState: 'stopped',
        replayInvalid: false,
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.runStatus).toEqual({
      phase: 'interrupted',
      runId: 'run-abort',
      endedAt: 1234,
      stopReason: 'user_abort',
      livenessState: 'stopped',
      replayInvalid: false,
    });
    expect(state.send.canAbort).toBe(false);
    expect(state.send.sending).toBe(false);
    expect(state.live.currentAssistant).toBeNull();
  });
```

- [ ] **Step 2: Run the reducer tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: FAIL because `currentAssistant`, `assistantSegments`, and `thinking` item support do not exist.

- [ ] **Step 3: Extend core types**

Modify `src/chat-core/openclaw-port/types.ts`:

```ts
export type AssistantStreamPhase = 'commentary' | 'final_answer' | 'legacy';

export type LiveAssistantSegment = {
  id: string;
  runId: string;
  text: string;
  phase: AssistantStreamPhase;
  ts: number;
  mediaUrls?: string[];
};

export type LiveThinkingSegment = {
  id: string;
  runId: string;
  text: string;
  ts: number;
};

export type ChatRunUiStatus = {
  phase: 'idle' | 'running' | 'done' | 'interrupted' | 'error';
  runId?: string;
  message?: string;
  endedAt?: number;
  stopReason?: string;
  livenessState?: string;
  replayInvalid?: boolean;
};
```

Replace the `live` shape in `ChatCoreState` with:

```ts
  live: {
    runId: string | null;
    currentAssistant: LiveAssistantSegment | null;
    assistantSegments: LiveAssistantSegment[];
    currentThinking: LiveThinkingSegment | null;
    thinkingSegments: LiveThinkingSegment[];
    toolMessages: RawOpenClawMessage[];
  };
```

Extend `VisibleChatItem`:

```ts
  | { kind: 'stream'; id: string; runId: string; text: string; phase: AssistantStreamPhase; mediaUrls?: string[] }
  | { kind: 'thinking'; id: string; runId: string; text: string };
```

- [ ] **Step 4: Extend action definitions**

Modify `src/chat-core/openclaw-port/actions.ts`:

```ts
  | {
    type: 'assistant.delta';
    sessionKey?: string;
    runId: string;
    text: string;
    ts: number;
    mode?: 'replace' | 'append';
    phase?: AssistantStreamPhase;
    mediaUrls?: string[];
  }
  | { type: 'thinking.delta'; sessionKey?: string; runId: string; text: string; ts: number; mode?: 'replace' | 'append' }
```

Keep the existing `chat.delta` action as a compatibility alias for legacy tests and callers.

- [ ] **Step 5: Initialize new live state**

Modify `src/chat-core/openclaw-port/state.ts`:

```ts
    live: {
      runId: null,
      currentAssistant: null,
      assistantSegments: [],
      currentThinking: null,
      thinkingSegments: [],
      toolMessages: [],
    },
```

- [ ] **Step 6: Map assistant and thinking events**

Modify `src/chat-core/openclaw-port/events.ts`:

```ts
function assistantPhase(value: string | undefined): AssistantStreamPhase {
  return value === 'commentary' || value === 'final_answer' ? value : 'legacy';
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] | undefined {
  const value = data[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}
```

Replace the assistant event branch with:

```ts
  if (event.stream === 'assistant' && event.runId) {
    const text = stringField(data, 'text');
    const delta = stringField(data, 'delta');
    const replace = booleanField(data, 'replace') === true;
    const visibleText = text ?? delta;
    if (visibleText) {
      actions.push({
        type: 'assistant.delta',
        sessionKey: event.sessionKey,
        runId: event.runId,
        text: visibleText,
        mode: text || replace ? 'replace' : 'append',
        phase: assistantPhase(phase),
        mediaUrls: stringArrayField(data, 'mediaUrls'),
        ts: numberField(event, 'ts') ?? Date.now(),
      });
    }
  }

  if (event.stream === 'thinking' && event.runId) {
    const text = stringField(data, 'text');
    const delta = stringField(data, 'delta');
    const replace = booleanField(data, 'replace') === true;
    const visibleText = text ?? delta;
    if (visibleText) {
      actions.push({
        type: 'thinking.delta',
        sessionKey: event.sessionKey,
        runId: event.runId,
        text: visibleText,
        mode: text || replace ? 'replace' : 'append',
        ts: numberField(event, 'ts') ?? Date.now(),
      });
    }
  }
```

Extend lifecycle mapping:

```ts
    if (phase === 'aborted' || phase === 'cancelled') {
      actions.push({
        type: 'run.status',
        status: {
          phase: 'interrupted',
          runId: event.runId,
          message: stringField(data, 'error'),
          endedAt: numberField(data, 'endedAt'),
          stopReason: stringField(data, 'stopReason'),
          livenessState: stringField(data, 'livenessState'),
          replayInvalid: booleanField(data, 'replayInvalid'),
        },
      });
    }
```

- [ ] **Step 7: Implement reducer cases**

Modify `src/chat-core/openclaw-port/reducer.ts`:

```ts
function appendOrReplace(prior: string, next: string, mode?: 'replace' | 'append'): string {
  return mode === 'append' ? `${prior}${next}` : next;
}

function segmentId(kind: 'assistant' | 'thinking', runId: string, ts: number, index: number): string {
  return `${kind}:${runId}:${ts}:${index}`;
}
```

Replace every live reset with:

```ts
live: {
  runId: null,
  currentAssistant: null,
  assistantSegments: [],
  currentThinking: null,
  thinkingSegments: [],
  toolMessages: [],
},
```

Add reducer cases:

```ts
    case 'assistant.delta': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const current = state.live.currentAssistant?.runId === action.runId
        ? state.live.currentAssistant
        : null;
      if (current && current.phase !== action.phase) {
        const committed = [...state.live.assistantSegments, current];
        const nextText = appendOrReplace('', action.text, action.mode);
        return {
          ...state,
          live: {
            ...state.live,
            runId: action.runId,
            assistantSegments: committed,
            currentAssistant: {
              id: segmentId('assistant', action.runId, action.ts, committed.length),
              runId: action.runId,
              text: nextText,
              phase: action.phase ?? 'legacy',
              ts: action.ts,
              ...(action.mediaUrls ? { mediaUrls: action.mediaUrls } : {}),
            },
          },
          send: { ...state.send, activeRunId: action.runId, canAbort: true },
        };
      }
      const text = appendOrReplace(current?.text ?? '', action.text, action.mode);
      return {
        ...state,
        live: {
          ...state.live,
          runId: action.runId,
          currentAssistant: {
            id: current?.id ?? segmentId('assistant', action.runId, action.ts, state.live.assistantSegments.length),
            runId: action.runId,
            text,
            phase: action.phase ?? current?.phase ?? 'legacy',
            ts: current?.ts ?? action.ts,
            ...(action.mediaUrls ?? current?.mediaUrls ? { mediaUrls: action.mediaUrls ?? current?.mediaUrls } : {}),
          },
        },
        send: { ...state.send, activeRunId: action.runId, canAbort: true },
      };
    }

    case 'thinking.delta': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const current = state.live.currentThinking?.runId === action.runId
        ? state.live.currentThinking
        : null;
      const text = appendOrReplace(current?.text ?? '', action.text, action.mode);
      return {
        ...state,
        live: {
          ...state.live,
          runId: action.runId,
          currentThinking: {
            id: current?.id ?? segmentId('thinking', action.runId, action.ts, state.live.thinkingSegments.length),
            runId: action.runId,
            text,
            ts: current?.ts ?? action.ts,
          },
        },
        send: { ...state.send, activeRunId: action.runId, canAbort: true },
      };
    }
```

Change the existing `chat.delta` case to dispatch the same shape as legacy assistant output by applying the same logic inline or by calling a local helper.

Update `run.status`:

```ts
    case 'run.status': {
      const terminal = action.status?.phase === 'done'
        || action.status?.phase === 'error'
        || action.status?.phase === 'interrupted';
      return {
        ...state,
        ...(terminal
          ? {
            live: {
              ...state.live,
              runId: null,
              currentAssistant: null,
              currentThinking: null,
            },
            send: { ...state.send, sending: false, activeRunId: null, canAbort: false },
          }
          : {}),
        runtime: { ...state.runtime, runStatus: action.status },
      };
    }
```

- [ ] **Step 8: Run reducer tests and commit**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/chat-core/openclaw-port/types.ts src/chat-core/openclaw-port/actions.ts src/chat-core/openclaw-port/state.ts src/chat-core/openclaw-port/events.ts src/chat-core/openclaw-port/reducer.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): model assistant phases and thinking"
```

## Task 3: Live Tool, Command Output, Patch, and Approval Upsert State

**Files:**

- Modify: `src/chat-core/openclaw-port/types.ts`
- Modify: `src/chat-core/openclaw-port/actions.ts`
- Modify: `src/chat-core/openclaw-port/state.ts`
- Modify: `src/chat-core/openclaw-port/events.ts`
- Modify: `src/chat-core/openclaw-port/reducer.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Add failing tests for live tool interleaving, command output, patch summary, and approval upsert**

Append these tests to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('commits current assistant text before a live tool card', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tool',
      stream: 'assistant',
      ts: 10,
      data: { text: 'I will read the file.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tool',
      stream: 'tool',
      ts: 20,
      data: { phase: 'start', toolCallId: 'call-1', name: 'read', args: { filePath: '/tmp/a.md' } },
    }).reduce(chatCoreReducer, state);

    const items = selectVisibleChatItems(state);
    expect(items.map((item) => item.kind)).toEqual(['stream', 'tool']);
    expect(items[0]).toMatchObject({ kind: 'stream', text: 'I will read the file.' });
    expect(items[1]).toMatchObject({ kind: 'tool', card: expect.objectContaining({ toolName: 'read' }) });
  });

  it('updates live tool cards from command output and patch events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    for (const event of [
      {
        sessionKey: 'agent:main:main',
        runId: 'run-tool',
        stream: 'tool',
        ts: 10,
        data: { phase: 'start', toolCallId: 'call-1', name: 'exec', args: { cmd: 'git status' } },
      },
      {
        sessionKey: 'agent:main:main',
        runId: 'run-tool',
        stream: 'command_output',
        ts: 20,
        data: { toolCallId: 'call-1', title: 'git status', output: 'clean', exitCode: 0, cwd: '/repo' },
      },
      {
        sessionKey: 'agent:main:main',
        runId: 'run-tool',
        stream: 'patch',
        ts: 30,
        data: { toolCallId: 'call-1', title: 'apply patch', summary: '1 file changed', modified: 1 },
      },
    ]) {
      state = actionsFromAgentEvent(event).reduce(chatCoreReducer, state);
    }

    expect(selectVisibleChatItems(state)).toEqual([
      expect.objectContaining({
        kind: 'tool',
        card: expect.objectContaining({
          toolName: 'exec',
          outputText: expect.stringContaining('clean'),
        }),
      }),
    ]);
    expect(state.live.patchSummaries).toEqual([
      expect.objectContaining({ summary: '1 file changed', modified: 1, toolCallId: 'call-1' }),
    ]);
  });

  it('upserts approval updates and ignores duplicate resolved events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: { phase: 'requested', approvalId: 'approval-1', status: 'pending', command: 'rm file' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: { phase: 'requested', approvalId: 'approval-1', status: 'pending', command: 'rm file' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: { phase: 'resolved', approvalId: 'approval-1', status: 'denied' },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([]);
    expect(state.runtime.resolvedApprovalIds).toContain('approval-1');
  });
```

- [ ] **Step 2: Run reducer tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: FAIL because live tool, command, patch, and resolved approval state do not exist.

- [ ] **Step 3: Extend types for live tools, commands, patches, and approvals**

Modify `src/chat-core/openclaw-port/types.ts`:

```ts
export type LiveToolEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  isError?: boolean;
  startedAt: number;
  updatedAt: number;
};

export type CommandOutputEntry = {
  id: string;
  runId: string;
  itemId?: string;
  toolCallId?: string;
  name?: string;
  title?: string;
  output?: string;
  status?: string;
  phase?: string;
  exitCode?: number;
  durationMs?: number;
  cwd?: string;
  ts: number;
};

export type PatchSummaryEntry = {
  id: string;
  runId: string;
  itemId?: string;
  toolCallId?: string;
  name?: string;
  title?: string;
  summary?: string;
  added?: number;
  modified?: number;
  deleted?: number;
  ts: number;
};
```

Extend `ChatCoreState.live`:

```ts
    toolStreamById: Record<string, LiveToolEntry>;
    toolStreamOrder: string[];
    commandOutputs: CommandOutputEntry[];
    patchSummaries: PatchSummaryEntry[];
```

Extend `ChatCoreState.runtime`:

```ts
    resolvedApprovalIds: string[];
```

Extend `VisibleChatItem`:

```ts
  | { kind: 'tool'; id: string; card: ToolCard }
  | { kind: 'command'; id: string; command: CommandOutputEntry }
  | { kind: 'patch'; id: string; patch: PatchSummaryEntry };
```

- [ ] **Step 4: Extend actions**

Modify `src/chat-core/openclaw-port/actions.ts`:

```ts
  | { type: 'tool.started'; sessionKey?: string; entry: LiveToolEntry }
  | { type: 'tool.updated'; sessionKey?: string; entry: Pick<LiveToolEntry, 'toolCallId' | 'runId' | 'name' | 'updatedAt'> & Partial<LiveToolEntry> }
  | { type: 'tool.completed'; sessionKey?: string; entry: Pick<LiveToolEntry, 'toolCallId' | 'runId' | 'name' | 'updatedAt'> & Partial<LiveToolEntry> }
  | { type: 'command.output'; sessionKey?: string; command: CommandOutputEntry }
  | { type: 'patch.completed'; sessionKey?: string; patch: PatchSummaryEntry }
  | { type: 'approval.upserted'; approval: ApprovalRequest }
```

- [ ] **Step 5: Map tool, command, patch, and approval events**

Modify `src/chat-core/openclaw-port/events.ts`:

```ts
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function serializeOutput(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
```

Add event branches:

```ts
  if (event.stream === 'tool' && event.runId) {
    const toolCallId = stringField(data, 'toolCallId');
    const name = stringField(data, 'name') ?? 'tool';
    if (!toolCallId) return actions;
    const ts = numberField(event, 'ts') ?? Date.now();
    const entry = {
      toolCallId,
      runId: event.runId,
      sessionKey: event.sessionKey,
      name,
      args: data.args,
      output: serializeOutput(data.result ?? data.partialResult),
      isError: booleanField(data, 'isError'),
      startedAt: ts,
      updatedAt: ts,
    };
    if (phase === 'start') actions.push({ type: 'tool.started', sessionKey: event.sessionKey, entry });
    if (phase === 'update') actions.push({ type: 'tool.updated', sessionKey: event.sessionKey, entry });
    if (phase === 'result' || phase === 'end') actions.push({ type: 'tool.completed', sessionKey: event.sessionKey, entry });
  }

  if (event.stream === 'command_output' && event.runId) {
    const ts = numberField(event, 'ts') ?? Date.now();
    const toolCallId = stringField(data, 'toolCallId');
    const itemId = stringField(data, 'itemId');
    actions.push({
      type: 'command.output',
      sessionKey: event.sessionKey,
      command: {
        id: toolCallId ?? itemId ?? `command:${event.runId}:${event.seq ?? ts}`,
        runId: event.runId,
        toolCallId,
        itemId,
        name: stringField(data, 'name'),
        title: stringField(data, 'title'),
        output: stringField(data, 'output'),
        status: stringField(data, 'status'),
        phase,
        exitCode: numberOrUndefined(data.exitCode),
        durationMs: numberOrUndefined(data.durationMs),
        cwd: stringField(data, 'cwd'),
        ts,
      },
    });
  }

  if (event.stream === 'patch' && event.runId) {
    const ts = numberField(event, 'ts') ?? Date.now();
    const toolCallId = stringField(data, 'toolCallId');
    const itemId = stringField(data, 'itemId');
    actions.push({
      type: 'patch.completed',
      sessionKey: event.sessionKey,
      patch: {
        id: toolCallId ?? itemId ?? `patch:${event.runId}:${event.seq ?? ts}`,
        runId: event.runId,
        toolCallId,
        itemId,
        name: stringField(data, 'name'),
        title: stringField(data, 'title'),
        summary: stringField(data, 'summary'),
        added: numberOrUndefined(data.added),
        modified: numberOrUndefined(data.modified),
        deleted: numberOrUndefined(data.deleted),
        ts,
      },
    });
  }
```

Change approval requested handling to dispatch `approval.upserted` instead of `approval.requested`; keep `approval.requested` reducer support for existing callers.

- [ ] **Step 6: Implement reducer upserts**

Modify `src/chat-core/openclaw-port/reducer.ts`:

```ts
function commitCurrentAssistantBeforeTool(state: ChatCoreState): ChatCoreState['live'] {
  if (!state.live.currentAssistant) return state.live;
  return {
    ...state.live,
    assistantSegments: [...state.live.assistantSegments, state.live.currentAssistant],
    currentAssistant: null,
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((entry, currentIndex) => (currentIndex === index ? { ...entry, ...item } : entry));
}
```

Add cases:

```ts
    case 'tool.started': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const live = commitCurrentAssistantBeforeTool(state);
      const exists = live.toolStreamById[action.entry.toolCallId];
      return {
        ...state,
        live: {
          ...live,
          runId: action.entry.runId,
          toolStreamById: {
            ...live.toolStreamById,
            [action.entry.toolCallId]: exists ? { ...exists, ...action.entry } : action.entry,
          },
          toolStreamOrder: exists ? live.toolStreamOrder : [...live.toolStreamOrder, action.entry.toolCallId],
        },
      };
    }

    case 'tool.updated':
    case 'tool.completed': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const prior = state.live.toolStreamById[action.entry.toolCallId];
      return {
        ...state,
        live: {
          ...state.live,
          runId: action.entry.runId,
          toolStreamById: {
            ...state.live.toolStreamById,
            [action.entry.toolCallId]: {
              ...(prior ?? {
                toolCallId: action.entry.toolCallId,
                runId: action.entry.runId,
                name: action.entry.name,
                startedAt: action.entry.updatedAt,
                updatedAt: action.entry.updatedAt,
              }),
              ...action.entry,
            },
          },
          toolStreamOrder: prior ? state.live.toolStreamOrder : [...state.live.toolStreamOrder, action.entry.toolCallId],
        },
      };
    }

    case 'command.output':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return { ...state, live: { ...state.live, commandOutputs: upsertById(state.live.commandOutputs, action.command) } };

    case 'patch.completed':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return { ...state, live: { ...state.live, patchSummaries: upsertById(state.live.patchSummaries, action.patch) } };

    case 'approval.upserted': {
      if (state.runtime.resolvedApprovalIds.includes(action.approval.id)) return state;
      const approvals = upsertById(state.runtime.approvals, action.approval);
      return { ...state, runtime: { ...state.runtime, approvals } };
    }
```

Update `approval.resolved`:

```ts
        runtime: {
          ...state.runtime,
          resolvedApprovalIds: [...new Set([...state.runtime.resolvedApprovalIds, ...action.ids])].slice(-100),
          approvals: state.runtime.approvals.filter((approval) => !approvalMatchesAnyId(approval, action.ids)),
        },
```

- [ ] **Step 7: Run reducer tests and commit**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/chat-core/openclaw-port/types.ts src/chat-core/openclaw-port/actions.ts src/chat-core/openclaw-port/state.ts src/chat-core/openclaw-port/events.ts src/chat-core/openclaw-port/reducer.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): track live tools command output and patches"
```

## Task 4: Visible Item Selector Pipeline

**Files:**

- Modify: `src/chat-core/openclaw-port/selectors.ts`
- Modify: `src/chat-core/openclaw-port/history.ts`
- Modify: `src/chat-core/openclaw-port/tool-cards.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Add failing selector tests**

Append these tests to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('filters heartbeat history and extracts thinking from history', () => {
    const state = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      hasMore: false,
      messages: [
        { id: 'heartbeat', role: 'assistant', content: 'HEARTBEAT_OK' },
        {
          id: 'assistant-thinking',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Check the repo.' },
            {
              type: 'text',
              text: 'Done.',
              textSignature: JSON.stringify({ v: 1, id: 'final-1', phase: 'final_answer' }),
            },
          ],
          timestamp: 10,
        },
      ],
    });

    expect(selectVisibleChatItems(state)).toEqual([
      expect.objectContaining({ kind: 'thinking', text: 'Check the repo.' }),
      expect.objectContaining({ kind: 'message', id: 'assistant-thinking' }),
    ]);
  });

  it('sorts queued user text before live assistant stream for the same turn', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'Question?',
        idempotencyKey: 'idem-1',
        state: 'sending',
      },
    });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'Answer',
      mode: 'replace',
      phase: 'final_answer',
      ts: 2,
    });

    expect(selectVisibleChatItems(state).map((item) => item.kind)).toEqual(['queue', 'stream']);
  });
```

- [ ] **Step 2: Run selector tests and verify they fail**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: FAIL because selectors do not emit history thinking items and do not consume new live state.

- [ ] **Step 3: Update history extraction to use phase-aware helpers**

Modify `src/chat-core/openclaw-port/history.ts`:

```ts
import {
  extractAssistantVisibleText,
  isHiddenAssistantMessage,
} from './message-extraction';
```

Change `extractMessageText`:

```ts
export function extractMessageText(message: RawOpenClawMessage): string {
  if (message.role === 'assistant') return extractAssistantVisibleText(message) ?? '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? [text] : [];
      })
      .join('');
  }
  return '';
}

export function shouldHideHistoryMessage(message: RawOpenClawMessage): boolean {
  return isHiddenAssistantMessage(message);
}
```

- [ ] **Step 4: Build live tool cards from entries**

Modify `src/chat-core/openclaw-port/tool-cards.ts`:

```ts
import type { LiveToolEntry } from './types';

export function toolCardFromLiveEntry(entry: LiveToolEntry): ToolCard {
  const inputText = serializeToolInput(entry.args);
  const outputText = entry.output;
  return {
    id: `live-tool:${entry.toolCallId}`,
    toolName: entry.name,
    inputText,
    outputText,
    isError: entry.isError,
    preview: buildPreview(outputText),
  };
}
```

If `serializeToolInput` and `buildPreview` are private, export them from the same file.

- [ ] **Step 5: Replace selector item construction**

Modify `src/chat-core/openclaw-port/selectors.ts`:

```ts
import {
  extractAssistantVisibleText,
  extractThinkingText,
  isHiddenStreamText,
} from './message-extraction';
import { toolCardFromLiveEntry } from './tool-cards';
```

Add helpers:

```ts
function timestampOfMessage(message: Record<string, unknown>, fallback: number): number {
  return typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
    ? message.timestamp
    : fallback;
}

function sortVisibleItems(items: VisibleChatItem[]): VisibleChatItem[] {
  return items
    .map((item, index) => ({
      item,
      index,
      ts:
        item.kind === 'message' ? timestampOfMessage(item.message, index)
          : item.kind === 'stream' ? stateTime(item.id, index)
            : item.kind === 'thinking' ? stateTime(item.id, index)
              : item.kind === 'tool' ? stateTime(item.id, index)
                : item.kind === 'command' ? item.command.ts
                  : item.kind === 'patch' ? item.patch.ts
                    : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => (a.ts === b.ts ? a.index - b.index : a.ts - b.ts))
    .map(({ item }) => item);
}

function stateTime(id: string, fallback: number): number {
  const parts = id.split(':');
  const maybeNumber = Number(parts.at(-2) ?? parts.at(-1));
  return Number.isFinite(maybeNumber) ? maybeNumber : fallback;
}
```

Update `selectVisibleChatItems` so it:

```ts
  const historyMessages = collapseDuplicateAttachmentUserEchoes(
    foldAssistantNarrationBeforeToolCalls(
      mergeAdjacentToolResultMessages(state.history.messages),
    ),
  ).filter((message) => !shouldHideHistoryMessage(message));
```

For each assistant history message:

```ts
    const thinking = extractThinkingText(message);
    if (thinking) {
      items.push({ kind: 'thinking', id: `thinking-${messageId(message, index)}`, runId: String(message.runId ?? 'history'), text: thinking });
    }
```

For live state:

```ts
  for (const segment of state.live.assistantSegments) {
    if (!isHiddenStreamText(segment.text)) {
      items.push({
        kind: 'stream',
        id: segment.id,
        runId: segment.runId,
        text: segment.text,
        phase: segment.phase,
        mediaUrls: segment.mediaUrls,
      });
    }
  }
  if (state.live.currentThinking && !isHiddenStreamText(state.live.currentThinking.text)) {
    items.push({
      kind: 'thinking',
      id: state.live.currentThinking.id,
      runId: state.live.currentThinking.runId,
      text: state.live.currentThinking.text,
    });
  }
  if (state.live.currentAssistant && !isHiddenStreamText(state.live.currentAssistant.text)) {
    items.push({
      kind: 'stream',
      id: state.live.currentAssistant.id,
      runId: state.live.currentAssistant.runId,
      text: state.live.currentAssistant.text,
      phase: state.live.currentAssistant.phase,
      mediaUrls: state.live.currentAssistant.mediaUrls,
    });
  }
  for (const toolCallId of state.live.toolStreamOrder) {
    const entry = state.live.toolStreamById[toolCallId];
    if (entry) items.push({ kind: 'tool', id: `tool-${toolCallId}`, card: toolCardFromLiveEntry(entry) });
  }
  for (const command of state.live.commandOutputs) {
    if (!state.live.toolStreamById[command.toolCallId ?? '']) {
      items.push({ kind: 'command', id: `command-${command.id}`, command });
    }
  }
  for (const patch of state.live.patchSummaries) {
    if (!state.live.toolStreamById[patch.toolCallId ?? '']) {
      items.push({ kind: 'patch', id: `patch-${patch.id}`, patch });
    }
  }
```

Return sorted items after runtime, approval, and status are appended. Preserve the existing queue-before-stream ordering by giving queue items their insertion position before live items.

- [ ] **Step 6: Run selector tests and commit**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-core-reducer.test.ts tests/unit/openclaw-chat-message-extraction.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/chat-core/openclaw-port/selectors.ts src/chat-core/openclaw-port/history.ts src/chat-core/openclaw-port/tool-cards.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): build phase-aware visible items"
```

## Task 5: React Rendering, i18n, and Composer Running Indicator

**Files:**

- Create: `src/pages/Chat/ThinkingBlock.tsx`
- Create: `src/pages/Chat/CommandCard.tsx`
- Create: `src/pages/Chat/PatchCard.tsx`
- Modify: `src/pages/Chat/MessageList.tsx`
- Modify: `src/pages/Chat/StreamingGroup.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/e2e/chat-openclaw-core.spec.ts`

- [ ] **Step 1: Add failing E2E assertions for new UI affordances**

Append a test to `tests/e2e/chat-openclaw-core.spec.ts`:

```ts
  test('renders thinking command patch and composer running label from raw agent events', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('openclaw-chat-surface')).toBeVisible({ timeout: 30_000 });

      await app.evaluate(({ BrowserWindow }, payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          for (const event of payload.events) win.webContents.send('gateway:agent-event', event);
        }
      }, {
        events: [
          { sessionKey: SESSION_KEY, runId: 'run-ui', stream: 'lifecycle', data: { phase: 'start' } },
          { sessionKey: SESSION_KEY, runId: 'run-ui', stream: 'thinking', ts: 10, data: { text: 'Check constraints.' } },
          { sessionKey: SESSION_KEY, runId: 'run-ui', stream: 'command_output', ts: 20, data: { title: 'git status', output: 'clean', exitCode: 0, cwd: '/repo' } },
          { sessionKey: SESSION_KEY, runId: 'run-ui', stream: 'patch', ts: 30, data: { title: 'apply patch', summary: '1 file changed', modified: 1 } },
        ],
      });

      await expect(page.getByTestId('chat-running-pulse')).toContainText('AI 回复中');
      await expect(page.getByTestId('chat-thinking-block')).toContainText('Check constraints.');
      await expect(page.getByTestId('chat-command-card')).toContainText('git status');
      await expect(page.getByTestId('chat-command-card')).toContainText('clean');
      await expect(page.getByTestId('chat-patch-card')).toContainText('1 file changed');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 2: Run the E2E test and verify it fails**

Run:

```bash
pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
```

Expected: FAIL because the new item renderers and `AI 回复中` label are not implemented.

- [ ] **Step 3: Add ThinkingBlock**

Create `src/pages/Chat/ThinkingBlock.tsx`:

```tsx
import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  return (
    <details
      className="w-[50vw] max-w-full rounded-md border border-border bg-surface-input px-3 py-2 text-sm text-muted-foreground"
      data-testid="chat-thinking-block"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-foreground">
        <Brain className="h-3.5 w-3.5" />
        {t('thinking.title')}
      </summary>
      <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">
        {text}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Add CommandCard**

Create `src/pages/Chat/CommandCard.tsx`:

```tsx
import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandOutputEntry } from '@/chat-core/openclaw-port/types';

export function CommandCard({ command }: { command: CommandOutputEntry }) {
  const { t } = useTranslation('chat');
  const title = command.title ?? command.name ?? t('command.title');
  return (
    <div className="w-[50vw] max-w-full rounded-md border border-border bg-surface-input text-sm" data-testid="chat-command-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-foreground">
        <Terminal className="h-3.5 w-3.5" />
        <span className="truncate">{title}</span>
        {typeof command.exitCode === 'number' ? (
          <span className="ml-auto shrink-0 text-muted-foreground">{t('command.exitCode', { code: command.exitCode })}</span>
        ) : null}
      </div>
      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        {command.cwd ? <div className="truncate font-mono">{command.cwd}</div> : null}
        {command.output ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{command.output}</pre> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add PatchCard**

Create `src/pages/Chat/PatchCard.tsx`:

```tsx
import { FileDiff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PatchSummaryEntry } from '@/chat-core/openclaw-port/types';

export function PatchCard({ patch }: { patch: PatchSummaryEntry }) {
  const { t } = useTranslation('chat');
  const title = patch.title ?? patch.name ?? t('patch.title');
  return (
    <div className="w-[50vw] max-w-full rounded-md border border-border bg-surface-input text-sm" data-testid="chat-patch-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-foreground">
        <FileDiff className="h-3.5 w-3.5" />
        <span className="truncate">{title}</span>
      </div>
      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        <div>
          {t('patch.counts', {
            added: patch.added ?? 0,
            modified: patch.modified ?? 0,
            deleted: patch.deleted ?? 0,
          })}
        </div>
        {patch.summary ? <div className="whitespace-pre-wrap break-words">{patch.summary}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Render new visible item kinds**

Modify `src/pages/Chat/MessageList.tsx` imports:

```ts
import { CommandCard } from './CommandCard';
import { PatchCard } from './PatchCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';
```

Add cases before the runtime case:

```tsx
            if (item.kind === 'thinking') {
              return (
                <article key={item.id} className="flex justify-start">
                  <ThinkingBlock text={item.text} />
                </article>
              );
            }
            if (item.kind === 'tool') {
              return (
                <article key={item.id} className="flex justify-start">
                  <ToolCard card={item.card} />
                </article>
              );
            }
            if (item.kind === 'command') {
              return (
                <article key={item.id} className="flex justify-start">
                  <CommandCard command={item.command} />
                </article>
              );
            }
            if (item.kind === 'patch') {
              return (
                <article key={item.id} className="flex justify-start">
                  <PatchCard patch={item.patch} />
                </article>
              );
            }
```

- [ ] **Step 7: Pass stream media and phase through StreamingGroup**

Modify `src/pages/Chat/StreamingGroup.tsx`:

```tsx
import type { AssistantStreamPhase } from '@/chat-core/openclaw-port/types';
import { stripInlineDirectiveTagsForDisplay } from '@/chat-core/openclaw-port/history';
import { ChatMessage } from './ChatMessage';

export function StreamingGroup({
  text,
  phase,
  mediaUrls,
}: {
  text: string;
  phase?: AssistantStreamPhase;
  mediaUrls?: string[];
}) {
  const displayText = stripInlineDirectiveTagsForDisplay(text);
  return (
    <article className="flex justify-start" data-testid="chat-streaming-group">
      <div className="w-full min-w-0 text-sm text-foreground">
        <ChatMessage
          message={{
            role: 'assistant',
            content: [{ type: 'text', text: displayText }],
            phase,
            mediaUrls,
          }}
          textOverride={displayText}
          suppressToolCards
          isStreaming
        />
      </div>
    </article>
  );
}
```

Modify the stream case in `MessageList.tsx`:

```tsx
if (item.kind === 'stream') {
  return <StreamingGroup key={item.id} text={item.text} phase={item.phase} mediaUrls={item.mediaUrls} />;
}
```

- [ ] **Step 8: Move the running pulse to the composer top-left with text**

Modify `ComposerActivityPulse` in `src/pages/Chat/index.tsx`:

```tsx
function ComposerActivityPulse({ label }: { label: string }) {
  return (
    <div className="px-4 pb-1" data-testid="chat-running-pulse">
      <div className="mx-auto flex max-w-4xl items-center justify-start px-1">
        <div className="flex h-5 items-center gap-2 text-xs font-medium text-muted-foreground" role="status" aria-label={label} title={label}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
```

Change usage:

```tsx
{showRunningPulse ? <ComposerActivityPulse label={t('runtime.replying')} /> : null}
```

- [ ] **Step 9: Add i18n keys**

Add these keys to all four locale files under `shared/i18n/locales/*/chat.json`.

English:

```json
{
  "thinking": {
    "title": "Thinking"
  },
  "command": {
    "title": "Command output",
    "exitCode": "exit {{code}}"
  },
  "patch": {
    "title": "Patch",
    "counts": "+{{added}} ~{{modified}} -{{deleted}}"
  },
  "runtime": {
    "replying": "AI replying"
  }
}
```

Chinese:

```json
{
  "thinking": {
    "title": "思考中"
  },
  "command": {
    "title": "命令输出",
    "exitCode": "退出码 {{code}}"
  },
  "patch": {
    "title": "补丁",
    "counts": "+{{added}} ~{{modified}} -{{deleted}}"
  },
  "runtime": {
    "replying": "AI 回复中"
  }
}
```

Japanese:

```json
{
  "thinking": {
    "title": "考え中"
  },
  "command": {
    "title": "コマンド出力",
    "exitCode": "終了 {{code}}"
  },
  "patch": {
    "title": "パッチ",
    "counts": "+{{added}} ~{{modified}} -{{deleted}}"
  },
  "runtime": {
    "replying": "AI が返信中"
  }
}
```

Russian:

```json
{
  "thinking": {
    "title": "Думаю"
  },
  "command": {
    "title": "Вывод команды",
    "exitCode": "код {{code}}"
  },
  "patch": {
    "title": "Патч",
    "counts": "+{{added}} ~{{modified}} -{{deleted}}"
  },
  "runtime": {
    "replying": "AI отвечает"
  }
}
```

Merge these into existing objects instead of replacing existing `runtime` keys.

- [ ] **Step 10: Run E2E and commit**

Run:

```bash
pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
```

Expected: PASS.

Commit:

```bash
git add src/pages/Chat/ThinkingBlock.tsx src/pages/Chat/CommandCard.tsx src/pages/Chat/PatchCard.tsx src/pages/Chat/MessageList.tsx src/pages/Chat/StreamingGroup.tsx src/pages/Chat/index.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/e2e/chat-openclaw-core.spec.ts
git commit -m "feat(chat): render OpenClaw runtime items"
```

## Task 6: Harness, Regression, and Full Verification

**Files:**

- Modify: `harness/specs/tasks/openclaw-chat-core-port.md`
- Test: `tests/e2e/chat-openclaw-core.spec.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`
- Test: `tests/unit/openclaw-chat-message-extraction.test.ts`

- [ ] **Step 1: Update the harness task spec**

Modify `harness/specs/tasks/openclaw-chat-core-port.md`.

Add to `expectedUserBehavior`:

```yaml
  - Thinking/reasoning output renders separately from normal assistant replies.
  - Assistant final_answer content is preferred over commentary content when displaying final replies.
  - Live tool, command_output, and patch agent streams render before history polling catches up.
  - Lifecycle aborted/cancelled events clear sending and abortable UI state.
  - The running state appears as a composer-adjacent pulse labeled "AI 回复中" instead of a full-width message row.
```

Add to `requiredTests`:

```yaml
  - pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts tests/unit/openclaw-chat-core-reducer.test.ts
  - pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
```

- [ ] **Step 2: Validate the harness task spec**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/openclaw-chat-core-port.md
```

Expected: PASS.

- [ ] **Step 3: Run focused unit tests**

Run:

```bash
pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts tests/unit/openclaw-chat-core-reducer.test.ts tests/unit/openclaw-chat-surface-store.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run focused E2E tests**

Run:

```bash
pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and lint**

Run:

```bash
pnpm run typecheck
pnpm run lint
```

Expected: both PASS.

- [ ] **Step 6: Run comms replay and compare**

Run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected: both PASS with no unreviewed baseline drift.

- [ ] **Step 7: Check docs sync**

Run:

```bash
git diff -- README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
```

Expected: no required user-facing README updates for this internal Chat rendering parity work. If a README already documents Chat runtime rendering details that contradict this implementation, update the affected README in the same commit.

- [ ] **Step 8: Commit verification and harness changes**

Commit:

```bash
git add harness/specs/tasks/openclaw-chat-core-port.md README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
git commit -m "test(chat): cover OpenClaw P0 P1 parity"
```

If no README file changed, run:

```bash
git add harness/specs/tasks/openclaw-chat-core-port.md
git commit -m "test(chat): cover OpenClaw P0 P1 parity"
```

## Final Acceptance

Before declaring the implementation complete, verify:

- `pnpm vitest run tests/unit/openclaw-chat-message-extraction.test.ts tests/unit/openclaw-chat-core-reducer.test.ts tests/unit/openclaw-chat-surface-store.test.ts`
- `pnpm run test:e2e -- tests/e2e/chat-openclaw-core.spec.ts`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `git status --short`

Expected final state:

- No duplicated user prompt in visible Chat items.
- Streaming assistant text stays after the matching user prompt.
- `final_answer` is rendered as the assistant reply; `commentary` is not mixed into it.
- Thinking is visible as a separate muted block.
- Live tool, command, and patch streams have visible cards.
- Approval cards upsert and resolve without duplicate pending cards.
- Abort/cancel lifecycle clears running state.
- The running pulse is above the composer input, aligned left, with `AI 回复中`.
- Renderer continues to use host APIs and host events rather than direct Gateway access.

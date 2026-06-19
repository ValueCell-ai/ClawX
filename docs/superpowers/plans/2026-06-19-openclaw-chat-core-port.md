# OpenClaw Chat Core Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ClawX Chat's ClawX-specific runtime protocol and message rendering path with an OpenClaw Chat Core driven React surface that still uses ClawX Electron host APIs and ClawX visual conventions.

**Architecture:** Vendor OpenClaw Web UI chat core semantics into `src/chat-core/openclaw-port`, adapt every RPC and event through a thin ClawX host API adapter, and expose state to React through a selector-driven Zustand binding. Main keeps Gateway ownership, but forwards upstream-shaped `agent` events so Renderer no longer depends on ClawX `ChatRuntimeEvent` for Chat rendering.

**Tech Stack:** Electron Main/Renderer IPC, React 19, TypeScript, Zustand, Vitest, Playwright Electron E2E, `react-i18next`, existing ClawX `hostApi` and `hostEvents`.

---

## Scope Check

The design contains several dependent subsystems: Gateway event forwarding, chat core port, send/history reconciliation, React surface, slash commands, compaction, approvals, and cleanup. They are sequentially dependent and should stay in one implementation plan because each phase enables the next and produces a testable Chat path.

## File Structure Map

Create:

- `src/chat-core/openclaw-port/types.ts` - OpenClaw-shaped chat/event/core state types used by the port.
- `src/chat-core/openclaw-port/actions.ts` - reducer action definitions.
- `src/chat-core/openclaw-port/state.ts` - initial core state helpers.
- `src/chat-core/openclaw-port/reducer.ts` - pure state reducer for history, send, stream, runtime, and approval actions.
- `src/chat-core/openclaw-port/selectors.ts` - visible item selectors consumed by React.
- `src/chat-core/openclaw-port/history.ts` - history load helpers and stale request guards.
- `src/chat-core/openclaw-port/send.ts` - send queue, idempotency, abort, reconnect flushing.
- `src/chat-core/openclaw-port/events.ts` - OpenClaw-shaped chat/agent event routing.
- `src/chat-core/openclaw-port/run-lifecycle.ts` - vendored/adapted OpenClaw run lifecycle logic.
- `src/chat-core/openclaw-port/stream-reconciliation.ts` - vendored/adapted OpenClaw stream reconciliation logic.
- `src/chat-core/openclaw-port/tool-cards.ts` - vendored/adapted tool card extraction and raw output helpers without Lit rendering.
- `src/chat-core/openclaw-port/slash-command-executor.ts` - vendored/adapted slash command behavior behind `ChatCoreClient`.
- `src/chat-core/clawx-adapter/client.ts` - `ChatCoreClient` implementation over `hostApi`.
- `src/chat-core/clawx-adapter/attachments.ts` - ClawX staged file to send payload conversion.
- `src/chat-core/clawx-adapter/host-events.ts` - host event subscription wiring for the new store.
- `src/stores/openclaw-chat-surface.ts` - thin Zustand binding around the core reducer.
- `src/pages/Chat/ChatSurface.tsx` - core surface container.
- `src/pages/Chat/MessageList.tsx` - visible item list.
- `src/pages/Chat/MessageGroup.tsx` - grouped user/assistant messages.
- `src/pages/Chat/StreamingGroup.tsx` - live assistant stream display.
- `src/pages/Chat/ToolCard.tsx` - React tool card.
- `src/pages/Chat/RawOutputPanel.tsx` - raw tool/full message panel.
- `src/pages/Chat/RunStatusBar.tsx` - run, queue, compaction, fallback indicators.
- `src/pages/Chat/ApprovalPrompt.tsx` - exec/plugin approval prompt.
- `src/pages/Chat/ChatComposer.tsx` - textarea composer shell with slash menu integration.
- `tests/unit/gateway-agent-events.test.ts` - Main dispatch and host-event contract tests.
- `tests/unit/openclaw-chat-core-reducer.test.ts` - pure reducer/reconciliation tests.
- `tests/unit/openclaw-chat-core-adapter.test.ts` - host API adapter tests.
- `tests/unit/openclaw-chat-surface-store.test.ts` - store subscription/action tests.
- `tests/unit/openclaw-chat-surface-render.test.tsx` - React component tests.
- `tests/e2e/chat-openclaw-core.spec.ts` - Electron Chat parity scenarios.
- `harness/specs/tasks/openclaw-chat-core-port.md` - task spec for communication path validation.

Modify:

- `shared/host-events/contract.ts` - add upstream-shaped Gateway agent event contract and channel.
- `src/lib/host-events.ts` - add `onGatewayAgentEvent`.
- `electron/gateway/event-dispatch.ts` - emit upstream-shaped `agent:event`.
- `electron/main/index.ts` - forward `agent:event` to `gateway:agent-event`.
- `src/stores/gateway.ts` - subscribe to `onGatewayAgentEvent` only for the new Chat store; keep old runtime path during transition.
- `src/pages/Chat/index.tsx` - use new surface/store as the default Chat path.
- `src/pages/Chat/ChatComposer.tsx` - preserve current file staging and picker behavior while adding slash behavior.
- `src/pages/Chat/ChatMessage.tsx` - retire from primary Chat path after new components render equivalent text/media behavior.
- `shared/i18n/locales/en/chat.json`
- `shared/i18n/locales/zh/chat.json`
- `shared/i18n/locales/ja/chat.json`
- `shared/i18n/locales/ru/chat.json`
- `README.md`
- `README.zh-CN.md`
- `README.ja-JP.md`
- `README.ru-RU.md`

Do not modify:

- OpenClaw upstream files under `/Users/zhuoxu/workspace/openclaw`.
- Renderer direct IPC APIs.
- Renderer direct Gateway HTTP/WS paths.

## Task 1: Forward Upstream-Shaped Agent Events Through Host Events

**Files:**

- Modify: `shared/host-events/contract.ts`
- Modify: `src/lib/host-events.ts`
- Modify: `electron/gateway/event-dispatch.ts`
- Modify: `electron/main/index.ts`
- Test: `tests/unit/host-events.test.ts`
- Test: `tests/unit/gateway-agent-events.test.ts`

- [ ] **Step 1: Add failing host-events test**

Append this test to `tests/unit/host-events.test.ts`:

```ts
  it('subscribes to upstream-shaped gateway agent events over IPC', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onGatewayAgentEvent(handler);
    const callback = on.mock.calls[0]?.[1] as ((payload: unknown) => void) | undefined;
    callback?.({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      seq: 7,
      stream: 'tool',
      data: { phase: 'start', toolCallId: 'call-1', name: 'read' },
    });

    expect(on).toHaveBeenCalledWith('gateway:agent-event', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      seq: 7,
      stream: 'tool',
      data: { phase: 'start', toolCallId: 'call-1', name: 'read' },
    });
  });
```

- [ ] **Step 2: Create failing Gateway dispatch test**

Create `tests/unit/gateway-agent-events.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  dispatchJsonRpcNotification,
  dispatchProtocolEvent,
} from '@electron/gateway/event-dispatch';

function makeEmitter() {
  const emit = vi.fn(() => true);
  return { emit };
}

describe('Gateway upstream agent event forwarding', () => {
  it('emits upstream-shaped agent:event for protocol agent events', () => {
    const emitter = makeEmitter();
    const payload = {
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'tool',
      seq: 1,
      data: { phase: 'start', toolCallId: 'call-1', name: 'read' },
    };

    dispatchProtocolEvent(emitter, 'agent', payload);

    expect(emitter.emit).toHaveBeenCalledWith('agent:event', payload);
    expect(emitter.emit).toHaveBeenCalledWith('notification', { method: 'agent', params: payload });
  });

  it('emits upstream-shaped agent:event for JSON-RPC agent notifications', () => {
    const emitter = makeEmitter();
    const payload = {
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'lifecycle',
      seq: 2,
      data: { phase: 'end' },
    };

    dispatchJsonRpcNotification(emitter, {
      method: 'agent',
      params: payload,
    });

    expect(emitter.emit).toHaveBeenCalledWith('agent:event', payload);
    expect(emitter.emit).toHaveBeenCalledWith('notification', {
      method: 'agent',
      params: payload,
    });
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-events.test.ts tests/unit/gateway-agent-events.test.ts
```

Expected: FAIL because `onGatewayAgentEvent` and `agent:event` forwarding are not implemented.

- [ ] **Step 4: Add host event contract**

Modify `shared/host-events/contract.ts`:

```ts
export type GatewayAgentEventPayload = JsonRecord & {
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  seq?: number;
  stream?: string;
  data?: JsonRecord;
};
```

Add to `HostEventContract.gateway`:

```ts
    agentEvent: (payload: GatewayAgentEventPayload) => void;
```

Add to `HOST_EVENT_CHANNELS.gateway`:

```ts
    agentEvent: 'gateway:agent-event',
```

- [ ] **Step 5: Add Renderer hostEvents helper**

Modify `src/lib/host-events.ts` inside `hostEvents`:

```ts
  onGatewayAgentEvent: (handler: HostEventHandler<'gateway', 'agentEvent'>) => (
    onGatewayEvent('agentEvent', handler)
  ),
```

- [ ] **Step 6: Emit upstream agent events in Gateway dispatch**

Modify `electron/gateway/event-dispatch.ts`:

```ts
    case 'agent': {
      emitter.emit('agent:event', payload);
      const normalized = normalizeGatewayChatRuntimeEvent(payload);
      if (normalized) {
        emitter.emit('chat:runtime-event', normalized);
      }
      emitter.emit('notification', { method: event, params: payload });
      break;
    }
```

Modify the JSON-RPC notification branch:

```ts
  if (notification.method === 'agent') {
    emitter.emit('agent:event', notification.params);
    const normalized = normalizeGatewayChatRuntimeEvent(notification.params);
    if (normalized) {
      emitter.emit('chat:runtime-event', normalized);
    }
  }
```

- [ ] **Step 7: Forward Main event to Renderer**

Modify `electron/main/index.ts` near existing Gateway listeners:

```ts
  gatewayManager.on('agent:event', (data) => {
    sendMainWindowEvent('gateway:agent-event', data);
  });
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-events.test.ts tests/unit/gateway-agent-events.test.ts
```

Expected: PASS.

- [ ] **Step 9: Typecheck node and web contracts**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add shared/host-events/contract.ts src/lib/host-events.ts electron/gateway/event-dispatch.ts electron/main/index.ts tests/unit/host-events.test.ts tests/unit/gateway-agent-events.test.ts
git commit -m "feat(chat): forward upstream agent events"
```

## Task 2: Add Chat Core Types, Reducer Skeleton, and Host API Adapter

**Files:**

- Create: `src/chat-core/openclaw-port/types.ts`
- Create: `src/chat-core/openclaw-port/actions.ts`
- Create: `src/chat-core/openclaw-port/state.ts`
- Create: `src/chat-core/openclaw-port/reducer.ts`
- Create: `src/chat-core/openclaw-port/selectors.ts`
- Create: `src/chat-core/clawx-adapter/client.ts`
- Create: `src/chat-core/clawx-adapter/attachments.ts`
- Test: `tests/unit/openclaw-chat-core-adapter.test.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/unit/openclaw-chat-core-adapter.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  gateway: {
    rpc: vi.fn(),
  },
  chat: {
    sendWithMedia: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

describe('createClawXChatCoreClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes generic RPCs through hostApi.gateway.rpc', async () => {
    hostApiMock.gateway.rpc.mockResolvedValueOnce({ messages: [] });
    const { createClawXChatCoreClient } = await import('@/chat-core/clawx-adapter/client');
    const client = createClawXChatCoreClient();

    const result = await client.request('chat.history', { sessionKey: 'agent:main:main' }, 5000);

    expect(result).toEqual({ messages: [] });
    expect(hostApiMock.gateway.rpc).toHaveBeenCalledWith(
      'chat.history',
      { sessionKey: 'agent:main:main' },
      5000,
    );
  });

  it('routes media sends through hostApi.chat.sendWithMedia when staged files are present', async () => {
    hostApiMock.chat.sendWithMedia.mockResolvedValueOnce({ success: true, result: { runId: 'run-1' } });
    const { createClawXChatCoreClient } = await import('@/chat-core/clawx-adapter/client');
    const client = createClawXChatCoreClient();

    const result = await client.request('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'describe this',
      idempotencyKey: 'send-1',
      clawxStagedFiles: [
        {
          fileName: 'image.png',
          filePath: '/tmp/image.png',
          mimeType: 'image/png',
        },
      ],
    });

    expect(result).toEqual({ runId: 'run-1' });
    expect(hostApiMock.chat.sendWithMedia).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      message: 'describe this',
      files: [
        {
          fileName: 'image.png',
          filePath: '/tmp/image.png',
          mimeType: 'image/png',
        },
      ],
      idempotencyKey: 'send-1',
    });
  });
});
```

- [ ] **Step 2: Write failing reducer tests**

Create `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createInitialChatCoreState } from '@/chat-core/openclaw-port/state';
import { chatCoreReducer } from '@/chat-core/openclaw-port/reducer';
import { selectVisibleChatItems } from '@/chat-core/openclaw-port/selectors';

describe('openclaw chat core reducer skeleton', () => {
  it('stores history messages for the selected session', () => {
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const next = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'hi' },
      ],
      hasMore: false,
    });

    expect(next.history.messages).toHaveLength(2);
    expect(selectVisibleChatItems(next)).toEqual([
      expect.objectContaining({ kind: 'message', id: 'u1' }),
      expect.objectContaining({ kind: 'message', id: 'a1' }),
    ]);
  });

  it('ignores stale history responses', () => {
    const state = chatCoreReducer(
      createInitialChatCoreState({ sessionKey: 'agent:main:main' }),
      { type: 'history.requested', sessionKey: 'agent:main:main', requestVersion: 2 },
    );

    const next = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'stale', role: 'assistant', content: 'old' }],
      hasMore: false,
    });

    expect(next.history.messages).toEqual([]);
    expect(next.history.requestVersion).toBe(2);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-adapter.test.ts tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Create core type files**

Create `src/chat-core/openclaw-port/types.ts`:

```ts
export type ChatCoreClient = {
  request<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
};

export type RawOpenClawMessage = Record<string, unknown> & {
  id?: string;
  role?: string;
  content?: unknown;
  text?: string;
  timestamp?: number;
};

export type OpenClawAgentEvent = Record<string, unknown> & {
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  seq?: number;
  stream?: string;
  data?: Record<string, unknown>;
};

export type ChatRunUiStatus = {
  phase: 'idle' | 'running' | 'done' | 'interrupted' | 'error';
  runId?: string;
  message?: string;
};

export type ChatQueueItem = {
  id: string;
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  state: 'queued' | 'sending' | 'waiting-reconnect' | 'failed';
  error?: string;
};

export type ApprovalRequest = {
  id: string;
  kind: 'exec' | 'plugin';
  title: string;
  detail: string;
  sessionKey?: string;
  agentId?: string;
  expiresAtMs?: number;
};

export type VisibleChatItem =
  | { kind: 'message'; id: string; message: RawOpenClawMessage }
  | { kind: 'stream'; id: string; runId: string; text: string }
  | { kind: 'queue'; id: string; item: ChatQueueItem }
  | { kind: 'status'; id: string; status: ChatRunUiStatus };

export type ChatCoreState = {
  sessionKey: string;
  selectedAgentId?: string;
  currentSessionId?: string;
  history: {
    messages: RawOpenClawMessage[];
    loading: boolean;
    hasMore: boolean;
    requestVersion: number;
  };
  live: {
    runId: string | null;
    stream: string | null;
    streamSegments: Array<{ text: string; ts: number }>;
    toolMessages: RawOpenClawMessage[];
  };
  send: {
    sending: boolean;
    queue: ChatQueueItem[];
    activeRunId: string | null;
    canAbort: boolean;
    lastError: string | null;
  };
  runtime: {
    runStatus: ChatRunUiStatus | null;
    compactionStatus: { phase: 'active' | 'retrying' | 'complete' | 'error'; message?: string } | null;
    fallbackStatus: { phase: 'active' | 'cleared'; message?: string } | null;
    approvals: ApprovalRequest[];
  };
};
```

Create `src/chat-core/openclaw-port/actions.ts`:

```ts
import type {
  ApprovalRequest,
  ChatQueueItem,
  ChatRunUiStatus,
  OpenClawAgentEvent,
  RawOpenClawMessage,
} from './types';

export type ChatCoreAction =
  | { type: 'session.changed'; sessionKey: string; selectedAgentId?: string }
  | { type: 'history.requested'; sessionKey: string; requestVersion: number }
  | {
    type: 'history.loaded';
    sessionKey: string;
    requestVersion: number;
    messages: RawOpenClawMessage[];
    hasMore: boolean;
  }
  | { type: 'send.enqueued'; item: ChatQueueItem }
  | { type: 'send.acked'; id: string; runId: string }
  | { type: 'send.failed'; id: string; error: string; recoverable: boolean }
  | { type: 'chat.delta'; sessionKey?: string; runId: string; text: string; ts: number }
  | { type: 'chat.final'; sessionKey?: string; runId: string }
  | { type: 'chat.error'; sessionKey?: string; runId?: string; error: string }
  | { type: 'agent.event'; event: OpenClawAgentEvent }
  | { type: 'run.status'; status: ChatRunUiStatus | null }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  | { type: 'approval.resolved'; id: string };
```

Create `src/chat-core/openclaw-port/state.ts`:

```ts
import type { ChatCoreState } from './types';

export function createInitialChatCoreState(input: {
  sessionKey: string;
  selectedAgentId?: string;
}): ChatCoreState {
  return {
    sessionKey: input.sessionKey,
    ...(input.selectedAgentId ? { selectedAgentId: input.selectedAgentId } : {}),
    history: {
      messages: [],
      loading: false,
      hasMore: false,
      requestVersion: 0,
    },
    live: {
      runId: null,
      stream: null,
      streamSegments: [],
      toolMessages: [],
    },
    send: {
      sending: false,
      queue: [],
      activeRunId: null,
      canAbort: false,
      lastError: null,
    },
    runtime: {
      runStatus: null,
      compactionStatus: null,
      fallbackStatus: null,
      approvals: [],
    },
  };
}
```

Create `src/chat-core/openclaw-port/reducer.ts`:

```ts
import type { ChatCoreAction } from './actions';
import type { ChatCoreState } from './types';

function eventMatchesSession(state: ChatCoreState, sessionKey?: string): boolean {
  return !sessionKey || sessionKey === state.sessionKey;
}

export function chatCoreReducer(state: ChatCoreState, action: ChatCoreAction): ChatCoreState {
  switch (action.type) {
    case 'session.changed':
      return {
        ...state,
        sessionKey: action.sessionKey,
        selectedAgentId: action.selectedAgentId,
        history: { ...state.history, messages: [], loading: false, requestVersion: state.history.requestVersion + 1 },
        live: { runId: null, stream: null, streamSegments: [], toolMessages: [] },
        send: { ...state.send, activeRunId: null, canAbort: false, lastError: null },
        runtime: { ...state.runtime, runStatus: null },
      };
    case 'history.requested':
      if (action.sessionKey !== state.sessionKey) return state;
      return {
        ...state,
        history: { ...state.history, loading: true, requestVersion: action.requestVersion },
      };
    case 'history.loaded':
      if (action.sessionKey !== state.sessionKey) return state;
      if (action.requestVersion !== state.history.requestVersion) return state;
      return {
        ...state,
        history: {
          messages: action.messages,
          loading: false,
          hasMore: action.hasMore,
          requestVersion: action.requestVersion,
        },
        live: { ...state.live, stream: null, runId: null, streamSegments: [] },
      };
    case 'send.enqueued':
      return {
        ...state,
        send: {
          ...state.send,
          sending: true,
          queue: [...state.send.queue, action.item],
          lastError: null,
        },
      };
    case 'send.acked':
      return {
        ...state,
        send: {
          ...state.send,
          activeRunId: action.runId,
          canAbort: true,
          queue: state.send.queue.map((item) => (
            item.id === action.id ? { ...item, state: 'sending' } : item
          )),
        },
      };
    case 'send.failed':
      return {
        ...state,
        send: {
          ...state.send,
          sending: action.recoverable,
          lastError: action.error,
          queue: state.send.queue.map((item) => (
            item.id === action.id
              ? { ...item, state: action.recoverable ? 'waiting-reconnect' : 'failed', error: action.error }
              : item
          )),
        },
      };
    case 'chat.delta':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return {
        ...state,
        live: {
          ...state.live,
          runId: action.runId,
          stream: action.text,
          streamSegments: [...state.live.streamSegments, { text: action.text, ts: action.ts }],
        },
        send: { ...state.send, activeRunId: action.runId, canAbort: true },
      };
    case 'chat.final':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return {
        ...state,
        live: { ...state.live, runId: null, stream: null, streamSegments: [] },
        send: { ...state.send, sending: false, activeRunId: null, canAbort: false },
        runtime: { ...state.runtime, runStatus: { phase: 'done', runId: action.runId } },
      };
    case 'chat.error':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return {
        ...state,
        live: { ...state.live, runId: null, stream: null, streamSegments: [] },
        send: { ...state.send, sending: false, activeRunId: null, canAbort: false, lastError: action.error },
        runtime: { ...state.runtime, runStatus: { phase: 'error', runId: action.runId, message: action.error } },
      };
    case 'run.status':
      return { ...state, runtime: { ...state.runtime, runStatus: action.status } };
    case 'approval.requested':
      if (state.runtime.approvals.some((approval) => approval.id === action.approval.id)) return state;
      return {
        ...state,
        runtime: { ...state.runtime, approvals: [...state.runtime.approvals, action.approval] },
      };
    case 'approval.resolved':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          approvals: state.runtime.approvals.filter((approval) => approval.id !== action.id),
        },
      };
    case 'agent.event':
      return state;
    default:
      return state;
  }
}
```

Create `src/chat-core/openclaw-port/selectors.ts`:

```ts
import type { ChatCoreState, VisibleChatItem } from './types';

function messageId(message: Record<string, unknown>, index: number): string {
  return typeof message.id === 'string' && message.id.trim()
    ? message.id
    : `history-${index}`;
}

export function selectVisibleChatItems(state: ChatCoreState): VisibleChatItem[] {
  const items: VisibleChatItem[] = state.history.messages.map((message, index) => ({
    kind: 'message',
    id: messageId(message, index),
    message,
  }));

  if (state.live.runId && state.live.stream) {
    items.push({
      kind: 'stream',
      id: `stream-${state.live.runId}`,
      runId: state.live.runId,
      text: state.live.stream,
    });
  }

  for (const item of state.send.queue) {
    if (item.state === 'queued' || item.state === 'waiting-reconnect' || item.state === 'failed') {
      items.push({ kind: 'queue', id: `queue-${item.id}`, item });
    }
  }

  if (state.runtime.runStatus && state.runtime.runStatus.phase !== 'idle') {
    items.push({
      kind: 'status',
      id: `status-${state.runtime.runStatus.runId ?? state.runtime.runStatus.phase}`,
      status: state.runtime.runStatus,
    });
  }

  return items;
}
```

- [ ] **Step 5: Create host adapter**

Create `src/chat-core/clawx-adapter/attachments.ts`:

```ts
export type ClawXStagedFile = {
  fileName: string;
  filePath: string;
  mimeType: string;
};

export function extractClawXStagedFiles(params: Record<string, unknown>): ClawXStagedFile[] {
  const files = params.clawxStagedFiles;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is ClawXStagedFile => {
    if (!file || typeof file !== 'object') return false;
    const entry = file as Record<string, unknown>;
    return (
      typeof entry.fileName === 'string' &&
      typeof entry.filePath === 'string' &&
      typeof entry.mimeType === 'string'
    );
  });
}

export function stripClawXAdapterFields<T extends Record<string, unknown>>(params: T): Omit<T, 'clawxStagedFiles'> {
  const { clawxStagedFiles: _ignored, ...rest } = params;
  return rest;
}
```

Create `src/chat-core/clawx-adapter/client.ts`:

```ts
import { hostApi } from '@/lib/host-api';
import type { ChatCoreClient } from '@/chat-core/openclaw-port/types';
import { extractClawXStagedFiles, stripClawXAdapterFields } from './attachments';

type ChatSendWithMediaResponse = {
  success?: boolean;
  result?: unknown;
  error?: string;
};

function unwrapMediaSendResult(response: ChatSendWithMediaResponse): unknown {
  if (response?.success === false) {
    throw new Error(response.error || 'chat.send media request failed');
  }
  return response?.result ?? response;
}

export function createClawXChatCoreClient(): ChatCoreClient {
  return {
    async request<T>(
      method: string,
      params: Record<string, unknown> = {},
      timeoutMs?: number,
    ): Promise<T> {
      if (method === 'chat.send') {
        const stagedFiles = extractClawXStagedFiles(params);
        if (stagedFiles.length > 0) {
          const response = await hostApi.chat.sendWithMedia({
            sessionKey: String(params.sessionKey ?? ''),
            message: String(params.message ?? ''),
            files: stagedFiles,
            idempotencyKey: typeof params.idempotencyKey === 'string' ? params.idempotencyKey : undefined,
          });
          return unwrapMediaSendResult(response as ChatSendWithMediaResponse) as T;
        }
      }

      return hostApi.gateway.rpc<T>(method, stripClawXAdapterFields(params), timeoutMs);
    },
  };
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-adapter.test.ts tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/chat-core tests/unit/openclaw-chat-core-adapter.test.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): add OpenClaw chat core skeleton"
```

## Task 3: Vendor OpenClaw Stream, Lifecycle, Tool, and Slash Core

**Files:**

- Modify: `src/chat-core/openclaw-port/stream-reconciliation.ts`
- Modify: `src/chat-core/openclaw-port/run-lifecycle.ts`
- Modify: `src/chat-core/openclaw-port/tool-cards.ts`
- Modify: `src/chat-core/openclaw-port/slash-command-executor.ts`
- Modify: `src/chat-core/openclaw-port/events.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Copy upstream source into the port directory**

Run these commands from `/Users/zhuoxu/workspace/ClawX`:

```bash
cp /Users/zhuoxu/workspace/openclaw/ui/src/ui/chat/stream-reconciliation.ts src/chat-core/openclaw-port/stream-reconciliation.ts
cp /Users/zhuoxu/workspace/openclaw/ui/src/ui/chat/run-lifecycle.ts src/chat-core/openclaw-port/run-lifecycle.ts
cp /Users/zhuoxu/workspace/openclaw/ui/src/ui/chat/tool-cards.ts src/chat-core/openclaw-port/tool-cards.ts
cp /Users/zhuoxu/workspace/openclaw/ui/src/ui/chat/slash-command-executor.ts src/chat-core/openclaw-port/slash-command-executor.ts
cp /Users/zhuoxu/workspace/openclaw/ui/src/ui/app-tool-stream.ts src/chat-core/openclaw-port/events.ts
```

Expected: five files copied.

- [ ] **Step 2: Add vendor headers**

At the top of each copied file, add:

```ts
/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */
```

- [ ] **Step 3: Remove Lit rendering dependencies from `tool-cards.ts`**

In `src/chat-core/openclaw-port/tool-cards.ts`, delete imports from `lit`, `lit/directives/keyed.js`, `../../i18n/index.ts`, `../canvas-url.ts`, `../embed-sandbox.ts`, `../icons.ts`, and UI sidebar types. Keep and export these pure functions:

```ts
export function isToolErrorOutput(outputText: string | undefined): boolean;
export function isToolCardError(card: ToolCard): boolean;
export function extractToolCards(message: unknown, prefix?: string): ToolCard[];
export function extractToolCardsCached(message: unknown, prefix?: string): ToolCard[];
export function formatToolOutputForRawPanel(card: ToolCard): string;
```

Define local `ToolCard` in the same file:

```ts
export type ToolCard = {
  id: string;
  toolName?: string;
  inputText?: string;
  outputText?: string;
  isError?: boolean;
  preview?: {
    kind: 'text' | 'json' | 'image' | 'unknown';
    label?: string;
    text?: string;
    url?: string;
  };
  transcriptMessageId?: string;
};
```

- [ ] **Step 4: Convert slash executor to `ChatCoreClient`**

In `src/chat-core/openclaw-port/slash-command-executor.ts`, replace the `GatewayBrowserClient` import with:

```ts
import type { ChatCoreClient } from './types';
```

Change the signature:

```ts
export async function executeSlashCommand(
  client: ChatCoreClient,
  sessionKey: string,
  commandName: string,
  args: string,
  context: SlashCommandContext = {},
): Promise<SlashCommandResult> {
```

Ensure every call uses `client.request<T>(method, params)`.

- [ ] **Step 5: Convert event handling to pure action creation**

In `src/chat-core/openclaw-port/events.ts`, replace class/host mutation exports with:

```ts
import type { ChatCoreAction } from './actions';
import type { OpenClawAgentEvent } from './types';

export function actionsFromAgentEvent(event: OpenClawAgentEvent): ChatCoreAction[] {
  const actions: ChatCoreAction[] = [{ type: 'agent.event', event }];
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const phase = typeof data.phase === 'string' ? data.phase : undefined;

  if (event.stream === 'lifecycle') {
    if (phase === 'start') {
      actions.push({ type: 'run.status', status: { phase: 'running', runId: event.runId } });
    }
    if (phase === 'end' || phase === 'completed') {
      actions.push({ type: 'run.status', status: { phase: 'done', runId: event.runId } });
    }
    if (phase === 'error') {
      actions.push({
        type: 'run.status',
        status: {
          phase: 'error',
          runId: event.runId,
          message: typeof data.error === 'string' ? data.error : undefined,
        },
      });
    }
  }

  if (event.stream === 'approval' && phase === 'requested') {
    const id = typeof data.id === 'string' ? data.id : `${event.runId ?? 'approval'}:${Date.now()}`;
    actions.push({
      type: 'approval.requested',
      approval: {
        id,
        kind: data.kind === 'plugin' ? 'plugin' : 'exec',
        title: typeof data.title === 'string' ? data.title : 'Approval required',
        detail: typeof data.command === 'string' ? data.command : JSON.stringify(data),
        sessionKey: event.sessionKey,
        agentId: event.agentId,
        expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : undefined,
      },
    });
  }

  return actions;
}
```

- [ ] **Step 6: Extend reducer tests for event action creation**

Append to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('turns upstream lifecycle agent events into run status actions', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'start' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(next.runtime.runStatus).toEqual({ phase: 'running', runId: 'run-1' });
  });

  it('turns upstream approval agent events into approval queue actions', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        id: 'approval-1',
        command: 'git status',
      },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(next.runtime.approvals).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        kind: 'exec',
        detail: 'git status',
      }),
    ]);
  });
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck and fix import boundaries**

Run:

```bash
pnpm run typecheck:web
```

Expected: PASS. If it fails on missing OpenClaw UI imports, replace those imports with local helpers in `src/chat-core/openclaw-port` rather than importing from `/Users/zhuoxu/workspace/openclaw`.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/chat-core/openclaw-port tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): vendor OpenClaw chat core helpers"
```

## Task 4: Implement History Loading and Visible Item Reconciliation

**Files:**

- Modify: `src/chat-core/openclaw-port/history.ts`
- Modify: `src/chat-core/openclaw-port/selectors.ts`
- Modify: `src/chat-core/openclaw-port/reducer.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Add failing tests for duplicate optimistic user and terminal stream replacement**

Append to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('replaces optimistic user message when matching history message arrives', () => {
    const initial = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const withQueued = chatCoreReducer(initial, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'hello',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });
    const requested = chatCoreReducer(withQueued, {
      type: 'history.requested',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
    });
    const loaded = chatCoreReducer(requested, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'hist-user-1', role: 'user', content: 'hello' }],
      hasMore: false,
    });

    const items = selectVisibleChatItems(loaded);

    expect(items.filter((item) => item.kind === 'message')).toHaveLength(1);
    expect(items.some((item) => item.kind === 'queue' && item.item.message === 'hello')).toBe(false);
  });

  it('does not render a stream when history contains the terminal assistant for the run', () => {
    const initial = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const streaming = chatCoreReducer(initial, {
      type: 'chat.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'partial',
      ts: 1,
    });
    const requested = chatCoreReducer(streaming, {
      type: 'history.requested',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
    });
    const loaded = chatCoreReducer(requested, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'assistant-final', role: 'assistant', runId: 'run-1', content: 'complete' }],
      hasMore: false,
    });

    expect(selectVisibleChatItems(loaded).some((item) => item.kind === 'stream')).toBe(false);
  });
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: FAIL because queue/history reconciliation still renders queued optimistic items.

- [ ] **Step 3: Add message text helpers**

Create `src/chat-core/openclaw-port/history.ts`:

```ts
import type { ChatQueueItem, RawOpenClawMessage } from './types';

export function extractMessageText(message: RawOpenClawMessage): string {
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

export function queueItemHasMatchingHistoryMessage(
  item: ChatQueueItem,
  messages: RawOpenClawMessage[],
): boolean {
  const expected = item.message.trim();
  if (!expected) return false;
  return messages.some((message) => {
    if (message.role !== 'user') return false;
    return extractMessageText(message).trim() === expected;
  });
}
```

- [ ] **Step 4: Filter acknowledged optimistic queue items in selector**

Modify `src/chat-core/openclaw-port/selectors.ts`:

```ts
import { queueItemHasMatchingHistoryMessage } from './history';
```

Replace queue rendering loop with:

```ts
  for (const item of state.send.queue) {
    if (queueItemHasMatchingHistoryMessage(item, state.history.messages)) continue;
    if (item.state === 'queued' || item.state === 'waiting-reconnect' || item.state === 'failed') {
      items.push({ kind: 'queue', id: `queue-${item.id}`, item });
    }
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/chat-core/openclaw-port/history.ts src/chat-core/openclaw-port/selectors.ts src/chat-core/openclaw-port/reducer.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): reconcile history with live chat items"
```

## Task 5: Implement Send Queue, Abort, and Gateway Status Recovery

**Files:**

- Modify: `src/chat-core/openclaw-port/send.ts`
- Modify: `src/chat-core/openclaw-port/actions.ts`
- Modify: `src/chat-core/openclaw-port/reducer.ts`
- Test: `tests/unit/openclaw-chat-core-reducer.test.ts`

- [ ] **Step 1: Add failing send queue tests**

Append to `tests/unit/openclaw-chat-core-reducer.test.ts`:

```ts
  it('keeps recoverable send failures in waiting-reconnect state', () => {
    const state = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'send.enqueued',
      item: {
        id: 'send-1',
        sessionKey: 'agent:main:main',
        message: 'hello',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });

    const failed = chatCoreReducer(state, {
      type: 'send.failed',
      id: 'send-1',
      error: 'RPC timeout: chat.send',
      recoverable: true,
    });

    expect(failed.send.sending).toBe(true);
    expect(failed.send.queue[0]).toEqual(expect.objectContaining({
      id: 'send-1',
      state: 'waiting-reconnect',
      error: 'RPC timeout: chat.send',
    }));
  });

  it('clears active run state on abort acknowledgement', () => {
    const state = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'send.acked',
      id: 'send-1',
      runId: 'run-1',
    });

    const aborted = chatCoreReducer(state, {
      type: 'chat.error',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      error: 'aborted',
    });

    expect(aborted.send.activeRunId).toBeNull();
    expect(aborted.send.canAbort).toBe(false);
    expect(aborted.runtime.runStatus).toEqual({
      phase: 'error',
      runId: 'run-1',
      message: 'aborted',
    });
  });
```

- [ ] **Step 2: Create send helper**

Create `src/chat-core/openclaw-port/send.ts`:

```ts
import type { ChatCoreClient, ChatQueueItem } from './types';

export function createIdempotencyKey(prefix = 'clawx-chat'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export function isRecoverableSendError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('RPC timeout: chat.send') ||
    message.includes('disconnected') ||
    message.includes('not connected') ||
    message.includes('Gateway unavailable')
  );
}

export function createQueueItem(input: {
  sessionKey: string;
  message: string;
  id?: string;
  idempotencyKey?: string;
}): ChatQueueItem {
  return {
    id: input.id ?? createIdempotencyKey('queue'),
    sessionKey: input.sessionKey,
    message: input.message,
    idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
    state: 'queued',
  };
}

export async function sendQueuedItem(
  client: ChatCoreClient,
  item: ChatQueueItem,
  extraParams: Record<string, unknown> = {},
): Promise<{ runId: string | null }> {
  const response = await client.request<{ runId?: string; idempotencyKey?: string }>('chat.send', {
    ...extraParams,
    sessionKey: item.sessionKey,
    message: item.message,
    deliver: false,
    idempotencyKey: item.idempotencyKey,
  }, 120000);
  return { runId: response.runId ?? response.idempotencyKey ?? null };
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-core-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/chat-core/openclaw-port/send.ts src/chat-core/openclaw-port/actions.ts src/chat-core/openclaw-port/reducer.ts tests/unit/openclaw-chat-core-reducer.test.ts
git commit -m "feat(chat): add OpenClaw-style send queue helpers"
```

## Task 6: Add Thin Zustand Store and Host Event Binding

**Files:**

- Create: `src/chat-core/clawx-adapter/host-events.ts`
- Create: `src/stores/openclaw-chat-surface.ts`
- Modify: `src/stores/gateway.ts`
- Test: `tests/unit/openclaw-chat-surface-store.test.ts`

- [ ] **Step 1: Write failing store test**

Create `tests/unit/openclaw-chat-surface-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostEventSubscriptionMock = vi.fn();

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayChatMessage: (handler: unknown) => hostEventSubscriptionMock('gateway:chat-message', handler),
    onGatewayAgentEvent: (handler: unknown) => hostEventSubscriptionMock('gateway:agent-event', handler),
    onGatewayStatus: (handler: unknown) => hostEventSubscriptionMock('gateway:status', handler),
  },
}));

describe('openclaw chat surface store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('routes chat delta host events into visible stream items', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: Record<string, unknown>) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();
    useOpenClawChatSurfaceStore.getState().setSessionKey('agent:main:main');

    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    });

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toEqual([
      expect.objectContaining({ kind: 'stream', runId: 'run-1', text: 'hello' }),
    ]);
  });

  it('routes upstream agent lifecycle events into run status', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: Record<string, unknown>) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();

    handlers.get('gateway:agent-event')?.({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'start' },
    });

    expect(useOpenClawChatSurfaceStore.getState().core.runtime.runStatus).toEqual({
      phase: 'running',
      runId: 'run-1',
    });
  });
});
```

- [ ] **Step 2: Create host event adapter**

Create `src/chat-core/clawx-adapter/host-events.ts`:

```ts
import { hostEvents } from '@/lib/host-events';
import { actionsFromAgentEvent } from '@/chat-core/openclaw-port/events';
import type { ChatCoreAction } from '@/chat-core/openclaw-port/actions';
import { extractMessageText } from '@/chat-core/openclaw-port/history';
import type { RawOpenClawMessage } from '@/chat-core/openclaw-port/types';

type Dispatch = (action: ChatCoreAction) => void;

function normalizeChatMessagePayload(payload: Record<string, unknown>): ChatCoreAction | null {
  const state = typeof payload.state === 'string' ? payload.state : undefined;
  const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
  const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined;
  const message = payload.message as RawOpenClawMessage | undefined;
  if (!state || !runId) return null;

  if (state === 'delta') {
    return {
      type: 'chat.delta',
      sessionKey,
      runId,
      text: extractMessageText(message ?? {}),
      ts: Date.now(),
    };
  }
  if (state === 'final') return { type: 'chat.final', sessionKey, runId };
  if (state === 'error') {
    return {
      type: 'chat.error',
      sessionKey,
      runId,
      error: typeof payload.errorMessage === 'string' ? payload.errorMessage : 'Chat run failed',
    };
  }
  if (state === 'aborted') {
    return { type: 'chat.error', sessionKey, runId, error: 'aborted' };
  }
  return null;
}

export function subscribeOpenClawChatHostEvents(dispatch: Dispatch): () => void {
  const cleanups = [
    hostEvents.onGatewayChatMessage((payload) => {
      const action = normalizeChatMessagePayload(payload as Record<string, unknown>);
      if (action) dispatch(action);
    }),
    hostEvents.onGatewayAgentEvent((payload) => {
      for (const action of actionsFromAgentEvent(payload)) {
        dispatch(action);
      }
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
```

- [ ] **Step 3: Create store**

Create `src/stores/openclaw-chat-surface.ts`:

```ts
import { create } from 'zustand';
import { chatCoreReducer } from '@/chat-core/openclaw-port/reducer';
import { createInitialChatCoreState } from '@/chat-core/openclaw-port/state';
import { selectVisibleChatItems } from '@/chat-core/openclaw-port/selectors';
import type { ChatCoreAction } from '@/chat-core/openclaw-port/actions';
import type { ChatCoreState, VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { subscribeOpenClawChatHostEvents } from '@/chat-core/clawx-adapter/host-events';

type OpenClawChatSurfaceStore = {
  core: ChatCoreState;
  visibleItems: VisibleChatItem[];
  initialized: boolean;
  dispatch: (action: ChatCoreAction) => void;
  setSessionKey: (sessionKey: string, selectedAgentId?: string) => void;
  initHostSubscriptions: () => void;
  disposeHostSubscriptions: () => void;
};

let cleanupHostSubscriptions: (() => void) | null = null;

export const useOpenClawChatSurfaceStore = create<OpenClawChatSurfaceStore>((set, get) => ({
  core: createInitialChatCoreState({ sessionKey: 'agent:main:main' }),
  visibleItems: [],
  initialized: false,
  dispatch: (action) => {
    set((state) => {
      const core = chatCoreReducer(state.core, action);
      return { core, visibleItems: selectVisibleChatItems(core) };
    });
  },
  setSessionKey: (sessionKey, selectedAgentId) => {
    get().dispatch({ type: 'session.changed', sessionKey, selectedAgentId });
  },
  initHostSubscriptions: () => {
    if (cleanupHostSubscriptions) return;
    cleanupHostSubscriptions = subscribeOpenClawChatHostEvents(get().dispatch);
    set({ initialized: true });
  },
  disposeHostSubscriptions: () => {
    cleanupHostSubscriptions?.();
    cleanupHostSubscriptions = null;
    set({ initialized: false });
  },
}));
```

- [ ] **Step 4: Run store tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/chat-core/clawx-adapter/host-events.ts src/stores/openclaw-chat-surface.ts tests/unit/openclaw-chat-surface-store.test.ts
git commit -m "feat(chat): bind OpenClaw chat core to host events"
```

## Task 7: Build Core React Surface Components

**Files:**

- Create: `src/pages/Chat/ChatSurface.tsx`
- Create: `src/pages/Chat/MessageList.tsx`
- Create: `src/pages/Chat/MessageGroup.tsx`
- Create: `src/pages/Chat/StreamingGroup.tsx`
- Create: `src/pages/Chat/ToolCard.tsx`
- Create: `src/pages/Chat/RawOutputPanel.tsx`
- Create: `src/pages/Chat/RunStatusBar.tsx`
- Test: `tests/unit/openclaw-chat-surface-render.test.tsx`

- [ ] **Step 1: Write failing React render tests**

Create `tests/unit/openclaw-chat-surface-render.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatSurface } from '@/pages/Chat/ChatSurface';
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';

describe('ChatSurface', () => {
  it('renders history messages and live streaming group separately', () => {
    const items: VisibleChatItem[] = [
      { kind: 'message', id: 'u1', message: { id: 'u1', role: 'user', content: 'hello' } },
      { kind: 'stream', id: 'stream-run-1', runId: 'run-1', text: 'working' },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByTestId('chat-streaming-group')).toHaveTextContent('working');
  });

  it('renders queue and run status items', () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'queue',
        id: 'queue-1',
        item: {
          id: 'send-1',
          sessionKey: 'agent:main:main',
          message: 'queued prompt',
          idempotencyKey: 'idem-1',
          state: 'waiting-reconnect',
        },
      },
      {
        kind: 'status',
        id: 'status-run-1',
        status: { phase: 'running', runId: 'run-1' },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByText('queued prompt')).toBeInTheDocument();
    expect(screen.getByTestId('chat-run-status')).toHaveTextContent('Running');
  });
});
```

- [ ] **Step 2: Create minimal components**

Create `src/pages/Chat/ChatSurface.tsx`:

```tsx
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { MessageList } from './MessageList';

export function ChatSurface({ items }: { items: VisibleChatItem[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" data-testid="openclaw-chat-surface">
      <MessageList items={items} />
    </section>
  );
}
```

Create `src/pages/Chat/MessageList.tsx`:

```tsx
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { MessageGroup } from './MessageGroup';
import { RunStatusBar } from './RunStatusBar';
import { StreamingGroup } from './StreamingGroup';

export function MessageList({ items }: { items: VisibleChatItem[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        {items.map((item) => {
          if (item.kind === 'message') return <MessageGroup key={item.id} message={item.message} />;
          if (item.kind === 'stream') return <StreamingGroup key={item.id} text={item.text} />;
          if (item.kind === 'queue') {
            return (
              <div key={item.id} className="rounded-md border border-border bg-surface-input px-3 py-2 text-sm text-muted-foreground">
                {item.item.message}
              </div>
            );
          }
          return <RunStatusBar key={item.id} status={item.status} />;
        })}
      </div>
    </div>
  );
}
```

Create `src/pages/Chat/MessageGroup.tsx`:

```tsx
import type { RawOpenClawMessage } from '@/chat-core/openclaw-port/types';
import { extractMessageText } from '@/chat-core/openclaw-port/history';

export function MessageGroup({ message }: { message: RawOpenClawMessage }) {
  const isUser = message.role === 'user';
  return (
    <article
      className={isUser ? 'flex justify-end' : 'flex justify-start'}
      data-testid={isUser ? 'chat-user-message' : 'chat-assistant-message'}
    >
      <div className={isUser
        ? 'max-w-[80%] rounded-lg bg-black/5 px-3 py-2 text-sm text-foreground dark:bg-white/10'
        : 'max-w-[85%] px-1 py-1 text-sm text-foreground'}
      >
        {extractMessageText(message)}
      </div>
    </article>
  );
}
```

Create `src/pages/Chat/StreamingGroup.tsx`:

```tsx
export function StreamingGroup({ text }: { text: string }) {
  return (
    <article className="flex justify-start" data-testid="chat-streaming-group">
      <div className="max-w-[85%] px-1 py-1 text-sm text-foreground">
        {text}
        <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded-sm bg-current align-middle" />
      </div>
    </article>
  );
}
```

Create `src/pages/Chat/RunStatusBar.tsx`:

```tsx
import type { ChatRunUiStatus } from '@/chat-core/openclaw-port/types';

const LABELS: Record<ChatRunUiStatus['phase'], string> = {
  idle: 'Idle',
  running: 'Running',
  done: 'Done',
  interrupted: 'Interrupted',
  error: 'Error',
};

export function RunStatusBar({ status }: { status: ChatRunUiStatus }) {
  return (
    <div className="rounded-md bg-surface-input px-3 py-2 text-xs text-muted-foreground" data-testid="chat-run-status">
      {LABELS[status.phase]}{status.message ? `: ${status.message}` : ''}
    </div>
  );
}
```

Create `src/pages/Chat/ToolCard.tsx`:

```tsx
import { useState } from 'react';
import type { ToolCard as ToolCardModel } from '@/chat-core/openclaw-port/tool-cards';

export function ToolCard({ card, onOpenRaw }: { card: ToolCardModel; onOpenRaw?: (card: ToolCardModel) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface-input text-sm" data-testid="chat-tool-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="font-mono text-xs">{card.toolName ?? 'tool'}</span>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {card.inputText ? <pre className="whitespace-pre-wrap text-xs">{card.inputText}</pre> : null}
          {card.outputText ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{card.outputText}</pre> : null}
          {onOpenRaw ? (
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onOpenRaw(card)}>
              Raw output
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

Create `src/pages/Chat/RawOutputPanel.tsx`:

```tsx
import type { ToolCard } from '@/chat-core/openclaw-port/tool-cards';

export function RawOutputPanel({ card, onClose }: { card: ToolCard | null; onClose: () => void }) {
  if (!card) return null;
  return (
    <aside className="w-96 border-l border-border bg-surface-modal" data-testid="chat-raw-output-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">{card.toolName ?? 'Tool output'}</h2>
        <button type="button" className="text-xs text-muted-foreground" onClick={onClose}>Close</button>
      </div>
      <pre className="h-full overflow-auto whitespace-pre-wrap p-3 text-xs">{card.outputText ?? ''}</pre>
    </aside>
  );
}
```

- [ ] **Step 3: Run render tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-render.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Replace hardcoded labels with i18n**

Move `Idle`, `Running`, `Done`, `Interrupted`, `Error`, `Show`, `Hide`, `Raw output`, `Close`, and `Tool output` into `shared/i18n/locales/*/chat.json`. Use `useTranslation('chat')` in components.

Use these English keys:

```json
{
  "runStatus": {
    "idle": "Idle",
    "running": "Running",
    "done": "Done",
    "interrupted": "Interrupted",
    "error": "Error"
  },
  "toolCard": {
    "show": "Show",
    "hide": "Hide",
    "rawOutput": "Raw output",
    "toolOutput": "Tool output"
  },
  "common": {
    "close": "Close"
  }
}
```

- [ ] **Step 5: Run i18n parity test**

Run:

```bash
pnpm exec vitest run tests/unit/i18n-locale-parity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/pages/Chat/ChatSurface.tsx src/pages/Chat/MessageList.tsx src/pages/Chat/MessageGroup.tsx src/pages/Chat/StreamingGroup.tsx src/pages/Chat/ToolCard.tsx src/pages/Chat/RawOutputPanel.tsx src/pages/Chat/RunStatusBar.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/openclaw-chat-surface-render.test.tsx
git commit -m "feat(chat): add OpenClaw-style React chat surface"
```

## Task 8: Integrate New Surface Into Chat Page as Default

**Files:**

- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/stores/openclaw-chat-surface.ts`
- Test: `tests/e2e/chat-openclaw-core.spec.ts`

- [ ] **Step 1: Add failing E2E for default surface**

Create `tests/e2e/chat-openclaw-core.spec.ts`:

```ts
import { expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('OpenClaw core Chat surface', () => {
  test('renders history on the default Chat page without duplicate user messages', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
          success: true,
          result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: {
            messages: [
              { id: 'u1', role: 'user', content: 'hello' },
              { id: 'a1', role: 'assistant', content: 'hi' },
            ],
          },
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
    await expect(page.getByText('hello')).toHaveCount(1);
    await expect(page.getByText('hi')).toBeVisible();
  });
});
```

- [ ] **Step 2: Add store history load action**

Modify `src/stores/openclaw-chat-surface.ts` to include:

```ts
import { createClawXChatCoreClient } from '@/chat-core/clawx-adapter/client';

const client = createClawXChatCoreClient();
let historyRequestVersion = 0;
```

Extend the store type:

```ts
  loadHistory: () => Promise<void>;
```

Add implementation:

```ts
  loadHistory: async () => {
    const { core, dispatch } = get();
    const requestVersion = ++historyRequestVersion;
    dispatch({ type: 'history.requested', sessionKey: core.sessionKey, requestVersion });
    const response = await client.request<{ messages?: unknown[] }>('chat.history', {
      sessionKey: core.sessionKey,
      limit: 200,
      maxChars: 500000,
    });
    dispatch({
      type: 'history.loaded',
      sessionKey: core.sessionKey,
      requestVersion,
      messages: Array.isArray(response.messages) ? response.messages as never[] : [],
      hasMore: false,
    });
  },
```

- [ ] **Step 3: Mount new surface in Chat page**

Modify `src/pages/Chat/index.tsx`:

```tsx
import { useEffect } from 'react';
import { ChatSurface } from './ChatSurface';
import { useOpenClawChatSurfaceStore } from '@/stores/openclaw-chat-surface';
```

Inside the page component, initialize:

```tsx
  const visibleItems = useOpenClawChatSurfaceStore((state) => state.visibleItems);
  const initHostSubscriptions = useOpenClawChatSurfaceStore((state) => state.initHostSubscriptions);
  const disposeHostSubscriptions = useOpenClawChatSurfaceStore((state) => state.disposeHostSubscriptions);
  const setSurfaceSessionKey = useOpenClawChatSurfaceStore((state) => state.setSessionKey);
  const loadSurfaceHistory = useOpenClawChatSurfaceStore((state) => state.loadHistory);

  useEffect(() => {
    initHostSubscriptions();
    return () => disposeHostSubscriptions();
  }, [disposeHostSubscriptions, initHostSubscriptions]);

  useEffect(() => {
    setSurfaceSessionKey(currentSessionKey, currentAgentId);
    void loadSurfaceHistory();
  }, [currentAgentId, currentSessionKey, loadSurfaceHistory, setSurfaceSessionKey]);
```

Render `<ChatSurface items={visibleItems} />` in place of the old message list. Keep current toolbar, composer, and artifact panel mounted.

- [ ] **Step 4: Run focused E2E**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-openclaw-core.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/pages/Chat/index.tsx src/stores/openclaw-chat-surface.ts tests/e2e/chat-openclaw-core.spec.ts
git commit -m "feat(chat): use OpenClaw chat surface by default"
```

## Task 9: Add Tool Cards and Raw Output to Visible Item Rendering

**Files:**

- Modify: `src/chat-core/openclaw-port/selectors.ts`
- Modify: `src/pages/Chat/MessageGroup.tsx`
- Modify: `src/pages/Chat/ToolCard.tsx`
- Modify: `src/pages/Chat/RawOutputPanel.tsx`
- Modify: `src/pages/Chat/ChatSurface.tsx`
- Test: `tests/unit/openclaw-chat-surface-render.test.tsx`
- Test: `tests/e2e/chat-openclaw-core.spec.ts`

- [ ] **Step 1: Add failing unit test for tool card rendering**

Append to `tests/unit/openclaw-chat-surface-render.test.tsx`:

```tsx
  it('renders tool use and tool result as a tool card with raw output', async () => {
    const items: VisibleChatItem[] = [
      {
        kind: 'message',
        id: 'assistant-tools',
        message: {
          id: 'assistant-tools',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/a.md' } },
            { type: 'tool_result', tool_use_id: 'call-1', content: 'file contents' },
          ],
        },
      },
    ];

    render(<ChatSurface items={items} />);

    expect(screen.getByTestId('chat-tool-card')).toHaveTextContent('read');
    expect(screen.queryByText('file contents')).not.toBeVisible();
  });
```

- [ ] **Step 2: Add tool card extraction to MessageGroup**

Modify `src/pages/Chat/MessageGroup.tsx`:

```tsx
import { extractToolCardsCached, type ToolCard as ToolCardModel } from '@/chat-core/openclaw-port/tool-cards';
import { ToolCard } from './ToolCard';
```

Inside component:

```tsx
  const toolCards = extractToolCardsCached(message, String(message.id ?? 'message'));
  const text = extractMessageText(message);
```

Render assistant content:

```tsx
        {text ? <div>{text}</div> : null}
        {toolCards.length > 0 ? (
          <div className="mt-2 space-y-2">
            {toolCards.map((card: ToolCardModel) => (
              <ToolCard key={card.id} card={card} />
            ))}
          </div>
        ) : null}
```

- [ ] **Step 3: Add raw output panel state in ChatSurface**

Modify `src/pages/Chat/ChatSurface.tsx`:

```tsx
import { useState } from 'react';
import type { ToolCard as ToolCardModel } from '@/chat-core/openclaw-port/tool-cards';
import { RawOutputPanel } from './RawOutputPanel';
```

Update component:

```tsx
export function ChatSurface({ items }: { items: VisibleChatItem[] }) {
  const [rawCard, setRawCard] = useState<ToolCardModel | null>(null);
  return (
    <section className="flex min-h-0 flex-1 bg-background" data-testid="openclaw-chat-surface">
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageList items={items} onOpenRaw={setRawCard} />
      </div>
      <RawOutputPanel card={rawCard} onClose={() => setRawCard(null)} />
    </section>
  );
}
```

Update `MessageList` and `MessageGroup` props to pass `onOpenRaw`.

- [ ] **Step 4: Run unit tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-render.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add E2E tool event scenario**

Extend `tests/e2e/chat-openclaw-core.spec.ts` with a test that sends `gateway:agent-event` or transcript history containing `tool_use` and `tool_result`, then asserts `chat-tool-card` is visible and raw panel opens.

Use this browser send snippet inside the test:

```ts
await app.evaluate(({ BrowserWindow }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('gateway:agent-event', {
      sessionKey: 'agent:main:main',
      runId: 'run-tools',
      stream: 'tool',
      data: { phase: 'start', toolCallId: 'call-1', name: 'read', args: { filePath: '/tmp/a.md' } },
    });
  }
});
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-render.test.tsx
pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-openclaw-core.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/chat-core/openclaw-port/selectors.ts src/pages/Chat/ChatSurface.tsx src/pages/Chat/MessageList.tsx src/pages/Chat/MessageGroup.tsx src/pages/Chat/ToolCard.tsx src/pages/Chat/RawOutputPanel.tsx tests/unit/openclaw-chat-surface-render.test.tsx tests/e2e/chat-openclaw-core.spec.ts
git commit -m "feat(chat): render OpenClaw tool cards"
```

## Task 10: Add Slash Menu, Skills Listing, and Command Execution

**Files:**

- Create: `src/pages/Chat/ChatComposer.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/chat-core/openclaw-port/slash-command-executor.ts`
- Modify: `src/stores/openclaw-chat-surface.ts`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/openclaw-chat-surface-render.test.tsx`
- Test: `tests/e2e/chat-skill-trigger-i18n.spec.ts`

- [ ] **Step 1: Add failing composer slash unit test**

Append to `tests/unit/openclaw-chat-surface-render.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event';
import { ChatComposer } from '@/pages/Chat/ChatComposer';

  it('shows slash menu with skills command from textarea input', async () => {
    const user = userEvent.setup();
    render(
      <ChatComposer
        disabled={false}
        sending={false}
        onSend={() => undefined}
        onStop={() => undefined}
        skills={[{ name: 'create-skill', description: 'Create reusable skills' }]}
      />,
    );

    await user.type(screen.getByTestId('chat-composer-input'), '/');

    expect(screen.getByRole('listbox', { name: /slash/i })).toBeInTheDocument();
    expect(screen.getByText('/skills')).toBeInTheDocument();
    expect(screen.getByText('/skill create-skill')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Implement ChatComposer wrapper**

Create `src/pages/Chat/ChatComposer.tsx` using the textarea behavior from current `ChatInput.tsx` and add slash menu state:

```tsx
import { useMemo, useRef, useState } from 'react';

type ComposerSkill = { name: string; description?: string };

type ChatComposerProps = {
  disabled: boolean;
  sending: boolean;
  skills?: ComposerSkill[];
  onSend: (text: string) => void;
  onStop: () => void;
};

const BASE_COMMANDS = ['/help', '/new', '/reset', '/clear', '/compact', '/model', '/think', '/verbose', '/agents', '/skills'];

export function ChatComposer({ disabled, sending, skills = [], onSend, onStop }: ChatComposerProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const slashOpen = text.trimStart().startsWith('/');
  const slashItems = useMemo(() => {
    const skillItems = skills.map((skill) => `/skill ${skill.name}`);
    return [...BASE_COMMANDS, ...skillItems];
  }, [skills]);

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
  };

  return (
    <div className="border-t border-border bg-surface-input p-3">
      <div className="relative mx-auto flex max-w-4xl items-end gap-2">
        {slashOpen ? (
          <div role="listbox" aria-label="Slash commands" className="absolute bottom-full left-0 mb-2 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface-modal shadow-lg">
            {slashItems.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setText(item.endsWith('/skills') ? item : `${item} `);
                  inputRef.current?.focus();
                }}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          data-testid="chat-composer-input"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="min-h-11 flex-1 resize-none rounded-md border border-border bg-surface-input px-3 py-2 text-sm"
        />
        <button type="button" data-testid="chat-composer-send" onClick={sending ? onStop : submit}>
          {sending ? 'Stop' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace hardcoded composer strings with i18n**

Add keys to four `chat.json` locale files:

```json
{
  "composer": {
    "slashCommands": "Slash commands",
    "send": "Send",
    "stop": "Stop"
  }
}
```

Use `useTranslation('chat')` in `ChatComposer` for labels and button text.

- [ ] **Step 4: Wire command execution**

Add store action in `src/stores/openclaw-chat-surface.ts`:

```ts
  executeComposerText: async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('/')) {
      const [nameWithSlash, ...rest] = trimmed.split(/\s+/);
      const name = nameWithSlash.slice(1);
      const args = rest.join(' ');
      const { executeSlashCommand } = await import('@/chat-core/openclaw-port/slash-command-executor');
      const result = await executeSlashCommand(client, get().core.sessionKey, name, args);
      if (result.action === 'refresh') await get().loadHistory();
      return;
    }
    const { createQueueItem, sendQueuedItem, isRecoverableSendError } = await import('@/chat-core/openclaw-port/send');
    const item = createQueueItem({ sessionKey: get().core.sessionKey, message: trimmed });
    get().dispatch({ type: 'send.enqueued', item });
    try {
      const ack = await sendQueuedItem(client, item);
      if (ack.runId) get().dispatch({ type: 'send.acked', id: item.id, runId: ack.runId });
    } catch (error) {
      get().dispatch({
        type: 'send.failed',
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
        recoverable: isRecoverableSendError(error),
      });
    }
  },
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-render.test.tsx tests/unit/i18n-locale-parity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run existing skill E2E**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-skill-trigger-i18n.spec.ts
```

Expected: PASS. If selectors changed from the previous composer, update the spec to assert the new textarea slash menu while preserving the localized skill behavior.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/pages/Chat/ChatComposer.tsx src/pages/Chat/index.tsx src/stores/openclaw-chat-surface.ts src/chat-core/openclaw-port/slash-command-executor.ts shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/openclaw-chat-surface-render.test.tsx tests/e2e/chat-skill-trigger-i18n.spec.ts
git commit -m "feat(chat): add slash composer and skills commands"
```

## Task 11: Add Compaction, Fallback, and Approval UI

**Files:**

- Create: `src/pages/Chat/ApprovalPrompt.tsx`
- Modify: `src/pages/Chat/RunStatusBar.tsx`
- Modify: `src/pages/Chat/ChatSurface.tsx`
- Modify: `src/stores/openclaw-chat-surface.ts`
- Modify: `src/chat-core/openclaw-port/events.ts`
- Test: `tests/unit/openclaw-chat-surface-render.test.tsx`
- Test: `tests/e2e/chat-openclaw-core.spec.ts`

- [ ] **Step 1: Add failing approval render test**

Append to `tests/unit/openclaw-chat-surface-render.test.tsx`:

```tsx
import { ApprovalPrompt } from '@/pages/Chat/ApprovalPrompt';

  it('renders approval prompt and resolves allow once', async () => {
    const user = userEvent.setup();
    const resolve = vi.fn();

    render(
      <ApprovalPrompt
        approval={{
          id: 'approval-1',
          kind: 'exec',
          title: 'Approval required',
          detail: 'git status',
        }}
        queueSize={1}
        onResolve={resolve}
      />,
    );

    await user.click(screen.getByRole('button', { name: /allow once/i }));

    expect(resolve).toHaveBeenCalledWith('approval-1', 'allow-once');
  });
```

- [ ] **Step 2: Implement ApprovalPrompt**

Create `src/pages/Chat/ApprovalPrompt.tsx`:

```tsx
import type { ApprovalRequest } from '@/chat-core/openclaw-port/types';

export function ApprovalPrompt({
  approval,
  queueSize,
  onResolve,
}: {
  approval: ApprovalRequest | null;
  queueSize: number;
  onResolve: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => void;
}) {
  if (!approval) return null;
  return (
    <div className="border-t border-border bg-surface-modal px-4 py-3" data-testid="chat-approval-prompt">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{approval.title}</div>
          <pre className="mt-1 overflow-hidden text-ellipsis whitespace-pre-wrap text-xs text-muted-foreground">{approval.detail}</pre>
          {queueSize > 1 ? <div className="mt-1 text-xs text-muted-foreground">{queueSize} approvals pending</div> : null}
        </div>
        <button type="button" onClick={() => onResolve(approval.id, 'deny')}>Deny</button>
        <button type="button" onClick={() => onResolve(approval.id, 'allow-once')}>Allow once</button>
        <button type="button" onClick={() => onResolve(approval.id, 'allow-always')}>Allow always</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace approval prompt labels with i18n**

Add keys to all four `shared/i18n/locales/*/chat.json` files:

```json
{
  "approval": {
    "title": "Approval required",
    "pendingCount": "{count} approvals pending",
    "deny": "Deny",
    "allowOnce": "Allow once",
    "allowAlways": "Allow always"
  }
}
```

Use `useTranslation('chat')` in `ApprovalPrompt` and replace the hardcoded labels with:

```tsx
const { t } = useTranslation('chat');
```

```tsx
<div className="text-sm font-medium">{approval.title || t('approval.title')}</div>
{queueSize > 1 ? (
  <div className="mt-1 text-xs text-muted-foreground">
    {t('approval.pendingCount', { count: queueSize })}
  </div>
) : null}
<button type="button" onClick={() => onResolve(approval.id, 'deny')}>{t('approval.deny')}</button>
<button type="button" onClick={() => onResolve(approval.id, 'allow-once')}>{t('approval.allowOnce')}</button>
<button type="button" onClick={() => onResolve(approval.id, 'allow-always')}>{t('approval.allowAlways')}</button>
```

- [ ] **Step 4: Add resolve action to store**

Modify `src/stores/openclaw-chat-surface.ts`:

```ts
  resolveApproval: async (id, decision) => {
    const approval = get().core.runtime.approvals.find((entry) => entry.id === id);
    if (!approval) return;
    const method = approval.kind === 'plugin' ? 'plugin.approval.resolve' : 'exec.approval.resolve';
    await client.request(method, { id, decision });
    get().dispatch({ type: 'approval.resolved', id });
  },
```

Add this method to the store type:

```ts
  resolveApproval: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => Promise<void>;
```

- [ ] **Step 5: Render approval prompt in ChatSurface**

Read `approvals` and `resolveApproval` from `useOpenClawChatSurfaceStore` in `src/pages/Chat/index.tsx`, then pass them through `ChatSurface` to `ApprovalPrompt`. Render:

```tsx
<ApprovalPrompt
  approval={approvals[0] ?? null}
  queueSize={approvals.length}
  onResolve={(id, decision) => void resolveApproval(id, decision)}
/>
```

- [ ] **Step 6: Extend event parser for compaction and fallback**

Modify `src/chat-core/openclaw-port/events.ts`:

```ts
  if (event.stream === 'compaction') {
    actions.push({
      type: 'run.status',
      status: {
        phase: phase === 'error' ? 'error' : phase === 'end' || phase === 'complete' ? 'done' : 'running',
        runId: event.runId,
        message: 'Compaction',
      },
    });
  }

  if (event.stream === 'fallback') {
    actions.push({
      type: 'run.status',
      status: {
        phase: phase === 'fallback_cleared' ? 'done' : 'running',
        runId: event.runId,
        message: 'Fallback',
      },
    });
  }
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-chat-surface-render.test.tsx tests/unit/openclaw-chat-surface-store.test.ts
pnpm exec vitest run tests/unit/i18n-locale-parity.test.ts
```

Expected: PASS.

- [ ] **Step 8: Add E2E approval event scenario**

Extend `tests/e2e/chat-openclaw-core.spec.ts` to send:

```ts
await app.evaluate(({ BrowserWindow }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('gateway:agent-event', {
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        id: 'approval-1',
        kind: 'exec',
        command: 'git status',
      },
    });
  }
});
```

Assert:

```ts
await expect(page.getByTestId('chat-approval-prompt')).toContainText('git status');
```

- [ ] **Step 9: Run focused E2E**

Run:

```bash
pnpm run build:vite && pnpm exec playwright test tests/e2e/chat-openclaw-core.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add src/pages/Chat/ApprovalPrompt.tsx src/pages/Chat/RunStatusBar.tsx src/pages/Chat/ChatSurface.tsx src/stores/openclaw-chat-surface.ts src/chat-core/openclaw-port/events.ts shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/openclaw-chat-surface-render.test.tsx tests/e2e/chat-openclaw-core.spec.ts
git commit -m "feat(chat): add compaction fallback and approval UI"
```

## Task 12: Clean Up Old Chat Runtime Main Path

**Files:**

- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/stores/gateway.ts`
- Modify: `src/stores/chat.ts`
- Modify: `shared/chat-runtime-events.ts`
- Modify: `electron/gateway/chat-runtime-events.ts`
- Test: `tests/unit/gateway-events.test.ts`
- Test: `tests/unit/chat-runtime-event-handlers.test.ts`

- [ ] **Step 1: Identify active imports**

Run:

```bash
rg -n "ChatRuntimeEvent|chat:runtime-event|onChatRuntimeEvent|handleRuntimeEvent|normalizeGatewayChatRuntimeEvent" src shared electron tests
```

Expected: output shows all remaining imports. Keep old runtime event code only where an existing non-Chat feature still needs it.

- [ ] **Step 2: Remove Chat page dependency on old runtime events**

In `src/pages/Chat/index.tsx`, remove imports and props tied only to:

```ts
deriveRuntimeTaskSteps
activeRuntimeRun
runtimeRuns
handleRuntimeEvent
chat-execution-graph
```

The new primary runtime display must come from `RunStatusBar`, `ToolCard`, and `ApprovalPrompt`.

- [ ] **Step 3: Keep transitional gateway store wiring isolated**

In `src/stores/gateway.ts`, keep this old call only if old tests or non-Chat code still import it:

```ts
useChatStore.getState().handleRuntimeEvent(event);
```

Wrap the old path behind a named helper:

```ts
function routeLegacyChatRuntimeEvent(event: unknown): void {
  useChatStore.getState().handleRuntimeEvent(event as never);
}
```

New OpenClaw Chat surface code must not call this helper.

- [ ] **Step 4: Update old tests to assert legacy isolation**

Modify `tests/unit/gateway-events.test.ts` so it expects both:

```ts
expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:agent-event', expect.any(Function));
expect(hostEventSubscriptionMock).toHaveBeenCalledWith('chat:runtime-event', expect.any(Function));
```

Also add:

```ts
expect(useOpenClawChatSurfaceStore.getState().core.runtime.runStatus).toEqual({
  phase: 'running',
  runId: 'run-1',
});
```

- [ ] **Step 5: Run legacy and new event tests**

Run:

```bash
pnpm exec vitest run tests/unit/gateway-events.test.ts tests/unit/chat-runtime-event-handlers.test.ts tests/unit/openclaw-chat-surface-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/pages/Chat/index.tsx src/stores/gateway.ts src/stores/chat.ts shared/chat-runtime-events.ts electron/gateway/chat-runtime-events.ts tests/unit/gateway-events.test.ts tests/unit/chat-runtime-event-handlers.test.ts tests/unit/openclaw-chat-surface-store.test.ts
git commit -m "refactor(chat): isolate legacy runtime event path"
```

## Task 13: Add Harness Task Spec and Documentation Updates

**Files:**

- Create: `harness/specs/tasks/openclaw-chat-core-port.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `README.ru-RU.md`
- Test: `tests/unit/harness-specs.test.ts`

- [ ] **Step 1: Create harness task spec**

Create `harness/specs/tasks/openclaw-chat-core-port.md`:

```md
# OpenClaw Chat Core Port

## Scenario

gateway-backend-communication

## Goal

Validate that ClawX Chat consumes upstream-shaped OpenClaw chat and agent events
through Main-owned host event IPC while preserving hostApi-only Renderer RPC
calls.

## Required Checks

- Renderer does not directly connect to Gateway HTTP or WebSocket endpoints.
- Renderer does not add direct `window.electron.ipcRenderer.invoke(...)` calls.
- `gateway:agent-event` reaches the OpenClaw Chat surface store.
- `chat.send` uses hostApi-backed RPC or `hostApi.chat.sendWithMedia`.
- `chat.history` uses hostApi-backed RPC.
- Tool, compaction, fallback, and approval events do not require ClawX
  `ChatRuntimeEvent` in the new Chat surface.

## Validation Commands

- `pnpm harness validate --spec harness/specs/tasks/openclaw-chat-core-port.md`
- `pnpm harness run --spec harness/specs/tasks/openclaw-chat-core-port.md --dry-run`
```

- [ ] **Step 2: Update READMEs**

In all four README files, update the Chat feature description to say:

```md
Chat now uses an OpenClaw-compatible chat core inside the Electron shell. The
Renderer still communicates through ClawX Main-process host APIs, while the chat
surface consumes upstream-shaped OpenClaw chat and agent events for streaming,
tool calls, compaction, fallback, and approvals.
```

Translate the sentence for `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md` while preserving the same technical meaning.

- [ ] **Step 3: Run harness checks**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/openclaw-chat-core-port.md
pnpm harness run --spec harness/specs/tasks/openclaw-chat-core-port.md --dry-run
pnpm exec vitest run tests/unit/harness-specs.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add harness/specs/tasks/openclaw-chat-core-port.md README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md
git commit -m "docs(chat): document OpenClaw chat core port"
```

## Task 14: Final Verification

**Files:**

- No planned code edits.

- [ ] **Step 1: Run unit tests for touched areas**

Run:

```bash
pnpm exec vitest run \
  tests/unit/host-events.test.ts \
  tests/unit/gateway-agent-events.test.ts \
  tests/unit/openclaw-chat-core-adapter.test.ts \
  tests/unit/openclaw-chat-core-reducer.test.ts \
  tests/unit/openclaw-chat-surface-store.test.ts \
  tests/unit/openclaw-chat-surface-render.test.tsx \
  tests/unit/gateway-events.test.ts \
  tests/unit/i18n-locale-parity.test.ts \
  tests/unit/harness-specs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint check**

Run:

```bash
pnpm run lint:check
```

Expected: PASS.

- [ ] **Step 5: Run communication validation**

Run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected: PASS with no chat communication regressions reported.

- [ ] **Step 6: Run focused Electron E2E**

Run:

```bash
pnpm run build:vite
pnpm exec playwright test \
  tests/e2e/chat-openclaw-core.spec.ts \
  tests/e2e/chat-skill-trigger-i18n.spec.ts \
  tests/e2e/chat-model-picker.spec.ts \
  tests/e2e/chat-file-changes.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Run harness CI parity**

Run:

```bash
pnpm run harness:ci
```

Expected: PASS.

- [ ] **Step 8: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -14
```

Expected: working tree contains only intentionally untracked local files such as `.codex/`, and the latest commits correspond to the tasks in this plan.

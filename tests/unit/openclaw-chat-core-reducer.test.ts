import { describe, expect, it, vi } from 'vitest';
import { createInitialChatCoreState } from '@/chat-core/openclaw-port/state';
import { chatCoreReducer } from '@/chat-core/openclaw-port/reducer';
import { selectVisibleChatItems } from '@/chat-core/openclaw-port/selectors';
import { extractDisplayMessageText } from '@/chat-core/openclaw-port/history';
import type { ChatCoreState, ChatQueueItem } from '@/chat-core/openclaw-port/types';

function createActiveRunState(runId = 'run-2'): ChatCoreState {
  let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
  state = chatCoreReducer(state, {
    type: 'send.acked',
    id: `send-${runId}`,
    runId,
  });
  return chatCoreReducer(state, {
    type: 'assistant.delta',
    sessionKey: 'agent:main:main',
    runId,
    text: `${runId} active answer.`,
    phase: 'final_answer',
    ts: 9000,
  });
}

function createMixedLiveAndSendRunState(): ChatCoreState {
  const liveRunOne = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
    type: 'assistant.delta',
    sessionKey: 'agent:main:main',
    runId: 'run-1',
    text: 'stale live answer',
    phase: 'final_answer',
    ts: 9001,
  });
  return {
    ...liveRunOne,
    send: {
      ...liveRunOne.send,
      activeRunId: 'run-2',
      canAbort: true,
    },
  };
}

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

  it('preserves visible run errors across history reloads', () => {
    let state = chatCoreReducer(
      createInitialChatCoreState({ sessionKey: 'agent:main:main' }),
      {
        type: 'run.status',
        sessionKey: 'agent:main:main',
        status: {
          phase: 'error',
          runId: 'run-provider-error',
          message: 'LLM request failed: provider rejected the request schema.',
        },
      },
    );

    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'u1', role: 'user', content: 'hello' }],
      hasMore: false,
    });

    expect(state.runtime.runStatus).toEqual({
      phase: 'error',
      runId: 'run-provider-error',
      message: 'LLM request failed: provider rejected the request schema.',
    });
    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'status',
      status: expect.objectContaining({ phase: 'error' }),
    }));
  });

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

    expect(next.runtime.runStatus).toEqual({
      phase: 'running',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
    });
  });

  it('turns lifecycle fallback_step events into runtime fallback status', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-fallback',
      stream: 'lifecycle',
      data: {
        phase: 'fallback_step',
        fallbackStepFinalOutcome: 'next_fallback',
        fallbackStepFromModel: 'openai/gpt-5.5',
        fallbackStepToModel: 'openrouter/meta-llama/llama-3.1-70b',
        fallbackStepFromFailureReason: 'rate_limit',
      },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(next.runtime.fallbackStatus).toEqual({
      phase: 'active',
      message: 'openai/gpt-5.5 -> openrouter/meta-llama/llama-3.1-70b: rate_limit',
    });
    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      status: expect.objectContaining({
        kind: 'fallback',
        phase: 'active',
      }),
    }));
  });

  it('marks exhausted lifecycle fallback_step events as fallback errors', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-fallback-error',
      stream: 'lifecycle',
      data: {
        phase: 'fallback_step',
        fallbackStepFinalOutcome: 'chain_exhausted',
        fallbackStepFromModel: 'custom-customcb/glm-5.2',
        fallbackStepFromFailureReason: 'format',
        fallbackStepFromFailureDetail: '400 Param Incorrect',
      },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(next.runtime.fallbackStatus).toEqual({
      phase: 'error',
      message: 'custom-customcb/glm-5.2: 400 Param Incorrect',
    });
  });

  it('turns upstream assistant agent text events into visible live stream content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stream',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'partial answer', delta: 'partial answer' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      runId: 'run-stream',
      text: 'partial answer',
    }));
  });

  it('turns media-only assistant agent events into visible live stream media', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const mediaUrl = '/api/chat/media/outgoing/agent%3Amain%3Alive/live-image/full';

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-media-only',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'NO_REPLY', mediaUrls: [mediaUrl] },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      runId: 'run-media-only',
      text: '',
      mediaUrls: [mediaUrl],
    }));
  });

  it('turns plan stream events into visible thinking content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-plan',
      stream: 'plan',
      ts: 1000,
      data: { text: 'Planning the answer.', delta: 'Planning the answer.' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-plan',
      text: 'Planning the answer.',
    }));
  });

  it('turns reasoning_content thinking payloads into visible thinking content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-reasoning-content',
      stream: 'thinking',
      ts: 1000,
      data: { reasoning_content: 'Need to inspect current context.' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-reasoning-content',
      text: 'Need to inspect current context.',
    }));
  });

  it('turns reasoning stream events into visible thinking content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-reasoning-stream',
      stream: 'reasoning',
      ts: 1000,
      data: { reasoning_content: 'Reason through the tool order.' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-reasoning-stream',
      text: 'Reason through the tool order.',
    }));
  });

  it('turns assistant reasoning-only events into visible thinking content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-assistant-reasoning',
      stream: 'assistant',
      ts: 1000,
      data: { reasoning_content: 'Private planning from an assistant stream.' },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-assistant-reasoning',
      text: 'Private planning from an assistant stream.',
    }));
  });

  it('turns nested thinking delta payloads into visible thinking content', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-nested-thinking',
      stream: 'thinking',
      ts: 1000,
      data: { delta: { reasoning_content: 'Nested reasoning text.' } },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-nested-thinking',
      text: 'Nested reasoning text.',
    }));
  });

  it('turns singular mediaUrl assistant agent events into visible live stream media', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const mediaUrl = '/api/chat/media/outgoing/agent%3Amain%3Alive/live-image/full';

    const actions = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-singular-media',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'NO_REPLY', mediaUrl },
    });

    const next = actions.reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      runId: 'run-singular-media',
      text: '',
      mediaUrls: [mediaUrl],
    }));
  });

  it('separates assistant commentary and final answer stream phases', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-phases',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'Inspecting files.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-phases',
      stream: 'assistant',
      ts: 1001,
      data: { text: 'Final answer.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);

    expect(state.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-phases',
      text: 'Final answer.',
      phase: 'final_answer',
    }));
    expect(state.live.assistantSegments).toContainEqual(expect.objectContaining({
      runId: 'run-phases',
      text: 'Inspecting files.',
      phase: 'commentary',
    }));
    const streamItems = selectVisibleChatItems(state).filter((item) => item.kind === 'stream');
    expect(streamItems.map((item) => ({
      runId: item.runId,
      text: item.text,
      phase: item.phase,
    }))).toEqual([
      { runId: 'run-phases', text: 'Inspecting files.', phase: 'commentary' },
      { runId: 'run-phases', text: 'Final answer.', phase: 'final_answer' },
    ]);
  });

  it('commits live assistant commentary before a live tool card', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tools',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'I will read the file.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tools',
      stream: 'tool',
      ts: 1001,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);

    const items = selectVisibleChatItems(state);
    expect(items.map((item) => item.kind)).toEqual(['stream', 'tool']);
    const toolItem = items.find((item) => item.kind === 'tool') as Extract<typeof items[number], { kind: 'tool' }> | undefined;
    expect(toolItem?.tool.toolName).toBe('read');
  });

  it('starts a new assistant stream segment when text resumes after a live tool', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'I will inspect it.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'tool',
      ts: 1001,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'exec',
        args: { command: 'ls' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'assistant',
      ts: 1002,
      data: { text: 'Here is what I found.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);

    const items = selectVisibleChatItems(state).filter((item) => (
      item.kind === 'stream' || item.kind === 'tool'
    ));

    expect(items.map((item) => item.kind)).toEqual(['stream', 'tool', 'stream']);
    expect(items[0]).toEqual(expect.objectContaining({ kind: 'stream', text: 'I will inspect it.' }));
    expect(items[2]).toEqual(expect.objectContaining({ kind: 'stream', text: 'Here is what I found.' }));
  });

  it('keeps live tool order when assistant resumes after tool start', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'I will inspect it.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'tool',
      ts: 1001,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'assistant',
      ts: 1002,
      data: { text: 'The file is short.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-interleaved',
      stream: 'tool',
      ts: 1003,
      data: {
        phase: 'end',
        toolCallId: 'call-1',
        name: 'read',
        result: 'contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(state).map((item) => (
      item.kind === 'stream' ? `${item.kind}:${item.text}` : item.kind
    ))).toEqual([
      'stream:I will inspect it.',
      'tool',
      'stream:The file is short.',
    ]);
  });

  it('keeps live assistant segments available after final until history can reconcile them', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-final-reconcile',
      stream: 'assistant',
      ts: 1000,
      data: { text: 'First explanation.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-final-reconcile',
      stream: 'tool',
      ts: 1001,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'web_search',
        args: { query: 'tech trends' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-final-reconcile',
      stream: 'assistant',
      ts: 1002,
      data: { text: 'Third explanation.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);
    state = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-final-reconcile',
    });

    expect(selectVisibleChatItems(state).map((item) => (
      item.kind === 'stream' ? `${item.kind}:${item.text}` : item.kind
    ))).toEqual([
      'stream:First explanation.',
      'tool',
      'stream:Third explanation.',
    ]);
    expect(state.send.sending).toBe(false);
  });

  it('keeps live terminal output visible when post-final history has not hydrated the user turn yet', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const queuedUser: ChatQueueItem = {
      id: 'queue-hydration',
      sessionKey: 'agent:main:main',
      message: 'Start a new chat',
      idempotencyKey: 'idem-hydration',
      createdAt: 1000,
      historyMessageCountAtEnqueue: 0,
      state: 'queued',
    };

    state = chatCoreReducer(state, { type: 'send.enqueued', item: queuedUser });
    state = chatCoreReducer(state, { type: 'send.acked', id: queuedUser.id, runId: 'run-hydration' });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-hydration',
      text: 'Live answer that should not blink away.',
      phase: 'final_answer',
      ts: 2000,
    });
    state = chatCoreReducer(state, {
      type: 'run.status',
      sessionKey: 'agent:main:main',
      status: { phase: 'done', runId: 'run-hydration' },
    });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [],
      hasMore: false,
    });

    const visibleItems = selectVisibleChatItems(state);
    expect(visibleItems).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({ id: queuedUser.id }),
    }));
    expect(visibleItems).toContainEqual(expect.objectContaining({
      kind: 'stream',
      text: 'Live answer that should not blink away.',
    }));
    expect(state.live.currentAssistant).toEqual(expect.objectContaining({
      text: 'Live answer that should not blink away.',
    }));
  });

  it('keeps optimistic user before live answer when post-final history is missing the user turn', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const queuedUser: ChatQueueItem = {
      id: 'queue-partial-hydration',
      sessionKey: 'agent:main:main',
      message: 'Start a new chat',
      idempotencyKey: 'idem-partial-hydration',
      createdAt: 1000,
      historyMessageCountAtEnqueue: 0,
      state: 'queued',
    };

    state = chatCoreReducer(state, { type: 'send.enqueued', item: queuedUser });
    state = chatCoreReducer(state, { type: 'send.acked', id: queuedUser.id, runId: 'run-partial-hydration' });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-partial-hydration',
      text: 'Live answer should stay after the optimistic user.',
      phase: 'final_answer',
      ts: 2000,
    });
    state = chatCoreReducer(state, {
      type: 'run.status',
      sessionKey: 'agent:main:main',
      status: { phase: 'done', runId: 'run-partial-hydration' },
    });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        { id: 'assistant-before-user', role: 'assistant', content: 'Persisted assistant before user.' },
      ],
      hasMore: false,
    });

    const visibleItems = selectVisibleChatItems(state);
    expect(visibleItems.map((item) => item.kind)).toEqual(['queue', 'stream']);
    expect(visibleItems[0]).toEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({ id: queuedUser.id }),
    }));
    expect(visibleItems[1]).toEqual(expect.objectContaining({
      kind: 'stream',
      text: 'Live answer should stay after the optimistic user.',
    }));
  });

  it('materializes missing live assistant text when history omits text before a tool call', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'user-1', role: 'user', content: '先解释、调用工具、再继续解释' }],
      hasMore: false,
    });
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-history-reconcile',
      stream: 'assistant',
      ts: 2000,
      data: { text: 'First explanation.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-history-reconcile',
      stream: 'tool',
      ts: 2001,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'web_search',
        args: { query: 'tech trends' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-history-reconcile',
      stream: 'assistant',
      ts: 2002,
      data: { text: 'Third explanation.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);
    state = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-history-reconcile',
    });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 2,
      messages: [
        { id: 'user-1', role: 'user', content: '先解释、调用工具、再继续解释' },
        {
          id: 'assistant-tool-call',
          role: 'assistant',
          content: [{ type: 'tool_call', id: 'call-1', name: 'web_search', input: { query: 'tech trends' } }],
        },
        {
          id: 'tool-result',
          role: 'tool_result',
          tool_call_id: 'call-1',
          content: 'search results',
        },
        { id: 'assistant-final', role: 'assistant', content: [{ type: 'text', text: 'Third explanation.' }] },
      ],
      hasMore: false,
    });

    expect(state.live.assistantSegments).toEqual([]);
    expect(state.live.currentAssistant).toBeNull();
    expect(state.history.messages.map((message) => extractDisplayMessageText(message))).toEqual([
      '先解释、调用工具、再继续解释',
      'First explanation.',
      '',
      'search results',
      'Third explanation.',
    ]);
    expect(state.history.messages[1]).toEqual(expect.objectContaining({
      openclawStreamFallback: expect.objectContaining({
        replacementText: 'First explanation.',
        beforeToolIds: expect.arrayContaining(['call-1']),
      }),
    }));
  });

  it('keeps result-only live tool card between assistant segments', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-result-only-boundary',
      stream: 'assistant',
      ts: 1050,
      data: { text: 'I will inspect it.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-result-only-boundary',
      stream: 'tool',
      ts: 1051,
      data: {
        phase: 'end',
        toolCallId: 'call-result-only',
        name: 'read',
        result: 'contents',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-result-only-boundary',
      stream: 'assistant',
      ts: 1052,
      data: { text: 'The file is short.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(state).map((item) => (
      item.kind === 'stream' ? `${item.kind}:${item.text}` : item.kind
    ))).toEqual([
      'stream:I will inspect it.',
      'tool',
      'stream:The file is short.',
    ]);
  });

  it('tracks tool streams identified only by stable tool ids', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-tool',
      stream: 'tool',
      ts: 1100,
      data: {
        phase: 'start',
        toolId: 'tool-stable-1',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-tool',
      stream: 'tool',
      ts: 1101,
      data: {
        phase: 'update',
        toolId: 'tool-stable-1',
        name: 'read',
        partialResult: 'partial contents',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-tool',
      stream: 'tool',
      ts: 1102,
      data: {
        phase: 'end',
        toolId: 'tool-stable-1',
        name: 'read',
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual(['tool-stable-1']);
    expect(state.live.toolStreamById['tool-stable-1']).toEqual(expect.objectContaining({
      id: 'tool-stable-1',
      toolId: 'tool-stable-1',
      identitySource: 'explicit',
      name: 'read',
      output: 'complete contents',
    }));
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(1);
  });

  it('does not collapse distinct id-less tool starts in the same run', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-tools',
      seq: 1,
      stream: 'tool',
      ts: 1200,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-tools',
      seq: 2,
      stream: 'tool',
      ts: 1201,
      data: {
        phase: 'start',
        name: 'list',
        args: { path: '/tmp' },
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual([
      'tool:run-idless-tools:1',
      'tool:run-idless-tools:2',
    ]);
    expect(Object.keys(state.live.toolStreamById)).toEqual([
      'tool:run-idless-tools:1',
      'tool:run-idless-tools:2',
    ]);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(2);
  });

  it('does not collapse id-less tool starts without seq or timestamp', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-no-event-id',
      stream: 'tool',
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-no-event-id',
      stream: 'tool',
      data: {
        phase: 'start',
        name: 'list',
        args: { path: '/tmp' },
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toHaveLength(2);
    expect(new Set(state.live.toolStreamOrder).size).toBe(2);
    expect(state.live.toolStreamOrder.every((id) => id.startsWith('tool:run-idless-no-event-id:'))).toBe(true);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(2);
  });

  it('does not collapse id-less tool starts with the same timestamp and no seq', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-same-ts',
      stream: 'tool',
      ts: 1250,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-same-ts',
      stream: 'tool',
      ts: 1250,
      data: {
        phase: 'start',
        name: 'list',
        args: { path: '/tmp' },
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toHaveLength(2);
    expect(new Set(state.live.toolStreamOrder).size).toBe(2);
    expect(state.live.toolStreamOrder.every((id) => id.startsWith('tool:run-idless-same-ts:1250:'))).toBe(true);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(2);
  });

  it('updates an id-less started tool on matching fallback completion', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-lifecycle',
      seq: 1,
      stream: 'tool',
      ts: 1300,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-lifecycle',
      seq: 2,
      stream: 'tool',
      ts: 1301,
      data: {
        phase: 'end',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual(['tool:run-idless-lifecycle:1']);
    expect(state.live.toolStreamById['tool:run-idless-lifecycle:1']).toEqual(expect.objectContaining({
      name: 'read',
      output: 'complete contents',
      status: 'end',
    }));
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(1);
  });

  it('updates an id-less started tool when completion omits args', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-lifecycle-without-completion-args',
      seq: 1,
      stream: 'tool',
      ts: 1400,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-lifecycle-without-completion-args',
      seq: 2,
      stream: 'tool',
      ts: 1401,
      data: {
        phase: 'end',
        name: 'read',
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual(['tool:run-idless-lifecycle-without-completion-args:1']);
    expect(state.live.toolStreamById['tool:run-idless-lifecycle-without-completion-args:1']).toEqual(expect.objectContaining({
      name: 'read',
      args: { filePath: '/tmp/a.md' },
      output: 'complete contents',
      status: 'end',
    }));
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'tool')).toHaveLength(1);
  });

  it('does not weak-match args-less completion when multiple fallback tools are viable', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-ambiguous-completion',
      seq: 1,
      stream: 'tool',
      ts: 1500,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-ambiguous-completion',
      seq: 2,
      stream: 'tool',
      ts: 1501,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/b.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-ambiguous-completion',
      seq: 3,
      stream: 'tool',
      ts: 1502,
      data: {
        phase: 'end',
        name: 'read',
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual([
      'tool:run-idless-ambiguous-completion:1',
      'tool:run-idless-ambiguous-completion:2',
      'tool:run-idless-ambiguous-completion:3',
    ]);
    expect(state.live.toolStreamById['tool:run-idless-ambiguous-completion:1']).toEqual(expect.objectContaining({
      args: { filePath: '/tmp/a.md' },
      status: 'start',
    }));
    expect(state.live.toolStreamById['tool:run-idless-ambiguous-completion:1'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-ambiguous-completion:2']).toEqual(expect.objectContaining({
      args: { filePath: '/tmp/b.md' },
      status: 'start',
    }));
    expect(state.live.toolStreamById['tool:run-idless-ambiguous-completion:2'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-ambiguous-completion:3']).toEqual(expect.objectContaining({
      output: 'complete contents',
      status: 'end',
    }));
  });

  it('does not exact-match identical fallback completion when multiple tools are viable', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-identical-completion',
      seq: 1,
      stream: 'tool',
      ts: 1550,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-identical-completion',
      seq: 2,
      stream: 'tool',
      ts: 1551,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-identical-completion',
      seq: 3,
      stream: 'tool',
      ts: 1552,
      data: {
        phase: 'end',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual([
      'tool:run-idless-identical-completion:1',
      'tool:run-idless-identical-completion:2',
      'tool:run-idless-identical-completion:3',
    ]);
    expect(state.live.toolStreamById['tool:run-idless-identical-completion:1']).toEqual(expect.objectContaining({
      args: { filePath: '/tmp/a.md' },
      status: 'start',
    }));
    expect(state.live.toolStreamById['tool:run-idless-identical-completion:1'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-identical-completion:2']).toEqual(expect.objectContaining({
      args: { filePath: '/tmp/a.md' },
      status: 'start',
    }));
    expect(state.live.toolStreamById['tool:run-idless-identical-completion:2'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-identical-completion:3']).toEqual(expect.objectContaining({
      output: 'complete contents',
      status: 'end',
    }));
  });

  it('does not weak-match after ambiguous exact fallback candidates', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-exact-plus-weak',
      seq: 1,
      stream: 'tool',
      ts: 1560,
      data: {
        phase: 'start',
        name: 'read',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-exact-plus-weak',
      seq: 2,
      stream: 'tool',
      ts: 1561,
      data: {
        phase: 'start',
        name: 'read',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-exact-plus-weak',
      seq: 3,
      stream: 'tool',
      ts: 1562,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-idless-exact-plus-weak',
      seq: 4,
      stream: 'tool',
      ts: 1563,
      data: {
        phase: 'end',
        name: 'read',
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual([
      'tool:run-idless-exact-plus-weak:1',
      'tool:run-idless-exact-plus-weak:2',
      'tool:run-idless-exact-plus-weak:3',
      'tool:run-idless-exact-plus-weak:4',
    ]);
    expect(state.live.toolStreamById['tool:run-idless-exact-plus-weak:1'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-exact-plus-weak:2'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-exact-plus-weak:3']).toEqual(expect.objectContaining({
      args: { filePath: '/tmp/a.md' },
      status: 'start',
    }));
    expect(state.live.toolStreamById['tool:run-idless-exact-plus-weak:3'].output).toBeUndefined();
    expect(state.live.toolStreamById['tool:run-idless-exact-plus-weak:4']).toEqual(expect.objectContaining({
      output: 'complete contents',
      status: 'end',
    }));
  });

  it('does not match fallback updates into terminal tools with uppercase statuses', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-uppercase-terminal-tool',
      seq: 1,
      stream: 'tool',
      ts: 1600,
      data: {
        phase: 'start',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-uppercase-terminal-tool',
      seq: 2,
      stream: 'tool',
      ts: 1601,
      data: {
        phase: 'end',
        status: 'DONE',
        name: 'read',
        args: { filePath: '/tmp/a.md' },
        result: 'complete contents',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-uppercase-terminal-tool',
      seq: 3,
      stream: 'tool',
      ts: 1602,
      data: {
        phase: 'update',
        name: 'read',
        partialResult: 'late output',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamOrder).toEqual([
      'tool:run-uppercase-terminal-tool:1',
      'tool:run-uppercase-terminal-tool:3',
    ]);
    expect(state.live.toolStreamById['tool:run-uppercase-terminal-tool:1']).toEqual(expect.objectContaining({
      output: 'complete contents',
      status: 'DONE',
    }));
    expect(state.live.toolStreamById['tool:run-uppercase-terminal-tool:3']).toEqual(expect.objectContaining({
      output: 'late output',
      status: 'update',
    }));
  });

  it('associates live command output and patch events with tool state', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command',
      stream: 'tool',
      ts: 2000,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'exec',
        args: { cmd: 'git status' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command',
      stream: 'command_output',
      ts: 2001,
      data: {
        toolCallId: 'call-1',
        output: 'clean',
        title: 'git status',
        exitCode: 0,
        cwd: '/repo',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command',
      stream: 'patch',
      ts: 2002,
      data: {
        toolCallId: 'call-1',
        summary: '1 file changed',
        modified: 1,
      },
    }).reduce(chatCoreReducer, state);

    const items = selectVisibleChatItems(state);
    const toolItem = items.find((item) => item.kind === 'tool') as Extract<typeof items[number], { kind: 'tool' }> | undefined;
    expect(toolItem?.tool.outputText).toContain('clean');
    expect(items.map((item) => item.kind)).toEqual(['tool', 'command', 'patch']);
    expect(items).toContainEqual(expect.objectContaining({
      kind: 'command',
      command: expect.objectContaining({
        toolCallId: 'call-1',
        output: 'clean',
        cwd: '/repo',
      }),
    }));
    expect(items).toContainEqual(expect.objectContaining({
      kind: 'patch',
      patch: expect.objectContaining({
        toolCallId: 'call-1',
        summary: '1 file changed',
        modified: 1,
      }),
    }));
    expect(state.live.patchSummaries).toContainEqual(expect.objectContaining({
      toolCallId: 'call-1',
      summary: '1 file changed',
      modified: 1,
    }));
  });

  it('associates command and patch entries by raw item id', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-item-association',
      stream: 'tool',
      ts: 2500,
      data: {
        phase: 'start',
        itemId: 'tool-item-1',
        name: 'exec',
        args: { cmd: 'git status' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-item-association',
      stream: 'command_output',
      ts: 2501,
      data: {
        id: 'command-output-1',
        itemId: 'tool-item-1',
        output: 'clean',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-item-association',
      stream: 'patch',
      ts: 2502,
      data: {
        id: 'patch-output-1',
        itemId: 'tool-item-1',
        summary: '1 file changed',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamById['tool-item-1']).toEqual(expect.objectContaining({
      commandOutputIds: ['command:command-output-1'],
      patchSummaryIds: ['patch:patch-output-1'],
      output: 'clean',
    }));
  });

  it('reconciles command and patch entries that arrive before their live tool', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-out-of-order-tool-association',
      seq: 1,
      stream: 'command_output',
      ts: 2600,
      data: {
        toolCallId: 'call-1',
        output: 'early clean',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-out-of-order-tool-association',
      seq: 2,
      stream: 'patch',
      ts: 2601,
      data: {
        toolCallId: 'call-1',
        summary: 'early patch',
        modified: 1,
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-out-of-order-tool-association',
      seq: 3,
      stream: 'tool',
      ts: 2602,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'exec',
        args: { cmd: 'git status' },
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamById['call-1']).toEqual(expect.objectContaining({
      commandOutputIds: ['command:run-out-of-order-tool-association:1'],
      patchSummaryIds: ['patch:run-out-of-order-tool-association:2'],
      output: 'early clean',
    }));
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'command')).toHaveLength(1);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'patch')).toHaveLength(1);
  });

  it('keeps distinct command outputs with the same tool call and different item ids', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command-items',
      stream: 'tool',
      ts: 3000,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'exec',
        args: { cmd: 'git status && git diff' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command-items',
      stream: 'command_output',
      ts: 3001,
      data: {
        toolCallId: 'call-1',
        itemId: 'command:status',
        output: 'status clean',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-command-items',
      stream: 'command_output',
      ts: 3002,
      data: {
        toolCallId: 'call-1',
        itemId: 'command:diff',
        output: 'diff empty',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.commandOutputs.map((entry) => entry.itemId)).toEqual([
      'command:status',
      'command:diff',
    ]);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'command')).toHaveLength(2);
  });

  it('keeps distinct command and patch entries with the same tool call and no explicit entry ids', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-shared-tool-call-entries',
      seq: 1,
      stream: 'tool',
      ts: 3100,
      data: {
        phase: 'start',
        toolCallId: 'call-1',
        name: 'exec',
        args: { cmd: 'git status && git diff' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-shared-tool-call-entries',
      seq: 2,
      stream: 'command_output',
      ts: 3101,
      data: {
        toolCallId: 'call-1',
        output: 'status clean',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-shared-tool-call-entries',
      seq: 3,
      stream: 'command_output',
      ts: 3102,
      data: {
        toolCallId: 'call-1',
        output: 'diff empty',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-shared-tool-call-entries',
      seq: 4,
      stream: 'patch',
      ts: 3103,
      data: {
        toolCallId: 'call-1',
        summary: 'status file changed',
        modified: 1,
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-shared-tool-call-entries',
      seq: 5,
      stream: 'patch',
      ts: 3104,
      data: {
        toolCallId: 'call-1',
        summary: 'diff file changed',
        added: 1,
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.commandOutputs.map((entry) => entry.output)).toEqual([
      'status clean',
      'diff empty',
    ]);
    expect(state.live.patchSummaries.map((entry) => entry.summary)).toEqual([
      'status file changed',
      'diff file changed',
    ]);
    expect(state.live.toolStreamById['call-1']).toEqual(expect.objectContaining({
      commandOutputIds: ['command:run-shared-tool-call-entries:2', 'command:run-shared-tool-call-entries:3'],
      patchSummaryIds: ['patch:run-shared-tool-call-entries:4', 'patch:run-shared-tool-call-entries:5'],
      output: 'diff empty',
    }));
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'command')).toHaveLength(2);
    expect(selectVisibleChatItems(state).filter((item) => item.kind === 'patch')).toHaveLength(2);
  });

  it('preserves rich tool command patch payloads and associates by stable tool ids', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-rich-live',
      stream: 'tool',
      ts: 4000,
      data: {
        phase: 'start',
        id: 'tool-entry-1',
        itemId: 'tool-item-1',
        toolCallId: 'call-1',
        callId: 'shell-call-1',
        name: 'exec',
        title: 'Run git status',
        status: 'running',
        args: { cmd: 'git status' },
        isError: true,
        error: 'permission denied while spawning shell',
        startedAt: 3998,
        updatedAt: 3999,
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-rich-live',
      stream: 'command_output',
      ts: 4001,
      data: {
        id: 'cmd-1',
        toolId: 'tool-entry-1',
        command: 'git status',
        stdout: 'clean',
        stderr: 'warning',
        stdoutExcerpt: 'clean',
        stderrExcerpt: 'warning',
        status: 'completed',
        exitCode: 0,
        cwd: '/repo',
        startedAt: 4001,
        updatedAt: 4002,
        endedAt: 4003,
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-rich-live',
      stream: 'patch',
      ts: 4004,
      data: {
        id: 'patch-1',
        parentItemId: 'tool-item-1',
        status: 'applied',
        summary: '2 files changed',
        files: ['src/a.ts', 'src/b.ts'],
        fileCount: 2,
        added: 1,
        modified: 1,
        deleted: 0,
      },
    }).reduce(chatCoreReducer, state);

    expect(state.live.toolStreamById['tool-entry-1']).toEqual(expect.objectContaining({
      id: 'tool-entry-1',
      itemId: 'tool-item-1',
      toolCallId: 'call-1',
      callId: 'shell-call-1',
      title: 'Run git status',
      status: 'running',
      errorText: 'permission denied while spawning shell',
      rawPayload: expect.objectContaining({ id: 'tool-entry-1' }),
      commandOutputIds: ['command:cmd-1'],
      patchSummaryIds: ['patch:patch-1'],
      startedAt: 3998,
      updatedAt: 4004,
    }));
    expect(state.live.commandOutputs).toContainEqual(expect.objectContaining({
      id: 'command:cmd-1',
      toolId: 'tool-entry-1',
      command: 'git status',
      stdout: 'clean',
      stderr: 'warning',
      stdoutExcerpt: 'clean',
      stderrExcerpt: 'warning',
      output: 'clean',
      status: 'completed',
      rawPayload: expect.objectContaining({ id: 'cmd-1' }),
      startedAt: 4001,
      updatedAt: 4002,
      endedAt: 4003,
    }));
    expect(state.live.patchSummaries).toContainEqual(expect.objectContaining({
      id: 'patch:patch-1',
      parentItemId: 'tool-item-1',
      status: 'applied',
      filePaths: ['src/a.ts', 'src/b.ts'],
      fileCount: 2,
      rawPayload: expect.objectContaining({ id: 'patch-1' }),
    }));
  });

  it('projects live tool error metadata without exposing raw payload fields', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tool-error-metadata',
      stream: 'tool',
      ts: 4050,
      data: {
        phase: 'start',
        toolCallId: 'call-error-metadata',
        name: 'exec',
        args: { cmd: 'git status' },
        isError: true,
        error: 'spawn denied',
        rawOutput: 'internal raw output should not project',
      },
    }).reduce(chatCoreReducer, createInitialChatCoreState({ sessionKey: 'agent:main:main' }));

    const tool = selectVisibleChatItems(state).find((item) => item.kind === 'tool');

    expect(tool).toEqual(expect.objectContaining({
      kind: 'tool',
      tool: expect.objectContaining({
        id: 'live:call-error-metadata',
        toolName: 'exec',
        outputText: 'spawn denied',
        isError: true,
      }),
    }));
    expect(tool?.kind === 'tool' ? tool.tool : undefined).not.toHaveProperty('rawPayload');
    expect(tool?.kind === 'tool' ? tool.tool.outputText : undefined).not.toContain('internal raw output');
  });

  it('uses live tool error text when output is blank', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-tool-blank-output',
      stream: 'tool',
      ts: 4051,
      data: {
        phase: 'end',
        toolCallId: 'call-blank-output',
        name: 'exec',
        output: '',
        error: 'spawn denied',
        isError: true,
      },
    }).reduce(chatCoreReducer, createInitialChatCoreState({ sessionKey: 'agent:main:main' }));

    const tool = selectVisibleChatItems(state).find((item) => item.kind === 'tool');

    expect(tool).toEqual(expect.objectContaining({
      kind: 'tool',
      tool: expect.objectContaining({
        outputText: 'spawn denied',
        isError: true,
      }),
    }));
  });

  it('renders thinking streams as separate visible items', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const next = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-thinking',
      stream: 'thinking',
      ts: 2000,
      data: { text: 'Reason about constraints.' },
    }).reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'thinking',
      runId: 'run-thinking',
      text: 'Reason about constraints.',
    }));
  });

  it('logs assistant reasoning-token events that do not include displayable thinking text', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');

    actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-missing-thinking',
      stream: 'assistant',
      data: {
        text: 'Visible answer only.',
        usage: { reasoningTokens: 42 },
      },
    });

    expect(debugSpy).toHaveBeenCalledWith(
      '[ClawX Chat] assistant event has reasoning tokens but no displayable thinking',
      expect.objectContaining({
        stream: 'assistant',
        runId: 'run-missing-thinking',
        reasoningTokens: 42,
      }),
    );

    debugSpy.mockRestore();
  });

  it('marks aborted lifecycle runs as interrupted and clears active send state', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'stop this run',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });
    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'local-1',
      runId: 'run-abort',
    });
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-abort',
      stream: 'lifecycle',
      data: { phase: 'start' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-abort',
      stream: 'assistant',
      ts: 3000,
      data: { text: 'Working...', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-abort',
      stream: 'lifecycle',
      data: {
        phase: 'aborted',
        endedAt: 3001,
        stopReason: 'user_abort',
        livenessState: 'cancelled',
        replayInvalid: true,
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.runStatus).toEqual({
      phase: 'interrupted',
      runId: 'run-abort',
      sessionKey: 'agent:main:main',
      endedAt: 3001,
      stopReason: 'user_abort',
      livenessState: 'cancelled',
      replayInvalid: true,
    });
    expect(state.send.canAbort).toBe(false);
    expect(state.send.sending).toBe(false);
    expect(state.send.activeRunId).toBeNull();
    expect(state.live.currentAssistant).toBeNull();
  });

  it('ignores lifecycle status events for a different session', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const next = actionsFromAgentEvent({
      sessionKey: 'agent:other:main',
      runId: 'foreign-run',
      stream: 'lifecycle',
      data: { phase: 'start' },
    }).reduce(chatCoreReducer, state);

    expect(next.runtime.runStatus).toBeNull();
  });

  it('does not let stale terminal lifecycle status clear the active run', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'send-2',
      runId: 'run-2',
    });
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'assistant',
      ts: 4000,
      data: { text: 'Run 2 still working.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'done' },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.runStatus).toBeNull();
    expect(state.send.activeRunId).toBe('run-2');
    expect(state.send.canAbort).toBe(true);
    expect(state.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-2',
      text: 'Run 2 still working.',
    }));
  });

  it('uses running lifecycle status as the current run when no live or send run exists', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'lifecycle',
      data: { phase: 'start' },
    }).reduce(chatCoreReducer, state);

    const staleDone = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'done' },
    }).reduce(chatCoreReducer, state);

    expect(staleDone.runtime.runStatus).toEqual({
      phase: 'running',
      runId: 'run-2',
      sessionKey: 'agent:main:main',
    });

    const matchingDone = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'lifecycle',
      data: { phase: 'done' },
    }).reduce(chatCoreReducer, state);

    expect(matchingDone.runtime.runStatus).toEqual({
      phase: 'done',
      runId: 'run-2',
      sessionKey: 'agent:main:main',
    });
  });

  it('does not let terminal lifecycle errors without run id clear an active stream', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'send-1',
      runId: 'run-active',
    });
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-active',
      stream: 'assistant',
      ts: 5000,
      data: { text: 'Still active.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      stream: 'lifecycle',
      data: { phase: 'error', message: 'missing run id' },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.runStatus).toBeNull();
    expect(state.send.activeRunId).toBe('run-active');
    expect(state.send.canAbort).toBe(true);
    expect(state.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-active',
      text: 'Still active.',
    }));
  });

  it('clears stale thinking when a different run starts assistant streaming', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'thinking',
      ts: 6000,
      data: { text: 'Old thought.' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'assistant',
      ts: 6001,
      data: { text: 'New answer.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);

    const liveItems = selectVisibleChatItems(state).filter((item) => (
      item.kind === 'thinking' || item.kind === 'stream'
    ));
    expect(liveItems).toEqual([
      expect.objectContaining({
        kind: 'stream',
        runId: 'run-2',
        text: 'New answer.',
      }),
    ]);
  });

  it('clears stale assistant stream when a different run starts thinking', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'assistant',
      ts: 7000,
      data: { text: 'Old answer.', phase: 'final_answer' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'thinking',
      ts: 7001,
      data: { text: 'New thought.' },
    }).reduce(chatCoreReducer, state);

    const liveItems = selectVisibleChatItems(state).filter((item) => (
      item.kind === 'thinking' || item.kind === 'stream'
    ));
    expect(liveItems).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        runId: 'run-2',
        text: 'New thought.',
      }),
    ]);
  });

  it('prefers send active run over stale live run for chat.final', () => {
    const state = createMixedLiveAndSendRunState();

    const staleFinal = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
    });

    expect(staleFinal.send.activeRunId).toBe('run-2');
    expect(staleFinal.send.canAbort).toBe(true);
    expect(staleFinal.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-1',
      text: 'stale live answer',
    }));
    expect(staleFinal.runtime.runStatus).toBeNull();

    const matchingFinal = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-2',
    });

    expect(matchingFinal.send.activeRunId).toBeNull();
    expect(matchingFinal.send.canAbort).toBe(false);
    expect(matchingFinal.live.currentAssistant).toBeNull();
    expect(matchingFinal.runtime.runStatus).toEqual({ phase: 'done', runId: 'run-2' });
  });

  it('prefers send active run over stale live run for lifecycle terminal status', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createMixedLiveAndSendRunState();

    const staleDone = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'done' },
    }).reduce(chatCoreReducer, state);

    expect(staleDone.send.activeRunId).toBe('run-2');
    expect(staleDone.send.canAbort).toBe(true);
    expect(staleDone.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-1',
      text: 'stale live answer',
    }));
    expect(staleDone.runtime.runStatus).toBeNull();

    const matchingDone = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'lifecycle',
      data: { phase: 'done' },
    }).reduce(chatCoreReducer, state);

    expect(matchingDone.send.activeRunId).toBeNull();
    expect(matchingDone.send.canAbort).toBe(false);
    expect(matchingDone.live.currentAssistant).toBeNull();
    expect(matchingDone.runtime.runStatus).toEqual({
      phase: 'done',
      runId: 'run-2',
      sessionKey: 'agent:main:main',
    });
  });

  it('does not clear active run for terminal status without run id', () => {
    const state = createActiveRunState('run-2');

    const next = chatCoreReducer(state, {
      type: 'run.status',
      sessionKey: 'agent:main:main',
      status: { phase: 'error', message: 'missing run id' },
    });

    expect(next.send.activeRunId).toBe('run-2');
    expect(next.send.canAbort).toBe(true);
    expect(next.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-2',
      text: 'run-2 active answer.',
    }));
    expect(next.runtime.runStatus).toBeNull();
  });

  it('accumulates v4 deltaText-only chat chunks until a replacement delta arrives', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'chat.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-delta',
      text: 'Hello',
      mode: 'append',
      ts: 1,
    });
    state = chatCoreReducer(state, {
      type: 'chat.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-delta',
      text: ' world',
      mode: 'append',
      ts: 2,
    });

    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      text: 'Hello world',
    }));

    state = chatCoreReducer(state, {
      type: 'chat.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-delta',
      text: 'Reset',
      mode: 'replace',
      ts: 3,
    });

    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'stream',
      text: 'Reset',
    }));
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

  it('upserts status-only pending and unavailable approval events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        status: 'pending',
        approvalId: 'approval-1',
        command: 'git status',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        status: 'unavailable',
        approvalId: 'approval-1',
        message: 'approval unavailable',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        status: 'unavailable',
        detail: 'approval unavailable',
      }),
    ]);
  });

  it('upserts duplicate approval requests and records resolved approval ids', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const requestedEvent = {
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        approvalId: 'approval-1',
        itemId: 'command:call-1',
        command: 'git status',
      },
    };

    state = actionsFromAgentEvent(requestedEvent).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent(requestedEvent).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toHaveLength(1);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'resolved',
        status: 'denied',
        approvalId: 'approval-1',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([]);
    expect(state.runtime.resolvedApprovalIds).toContain('approval-1');
  });

  it('extracts snake_case approval identifiers from upstream approval events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval-snake',
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        approval_id: 'approval-snake-1',
        approval_slug: 'approval-snake-slug',
        item_id: 'command:snake',
        tool_call_id: 'call-snake',
        command: 'git status',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([
      expect.objectContaining({
        id: 'approval-snake-1',
        approvalId: 'approval-snake-1',
        approvalSlug: 'approval-snake-slug',
        itemId: 'command:snake',
        toolCallId: 'call-snake',
      }),
    ]);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval-snake',
      stream: 'approval',
      data: {
        phase: 'resolved',
        status: 'denied',
        approval_id: 'approval-snake-1',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([]);
    expect(state.runtime.resolvedApprovalIds).toContain('approval-snake-1');
  });

  it('ignores approval requests from a different session', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const next = actionsFromAgentEvent({
      sessionKey: 'agent:other:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        approvalId: 'approval-1',
        command: 'git status',
      },
    }).reduce(chatCoreReducer, state);

    expect(next.runtime.approvals).toEqual([]);
  });

  it('ignores approval resolutions from a different session when ids collide', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        approvalId: 'approval-1',
        command: 'git status',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:other:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'resolved',
        status: 'denied',
        approvalId: 'approval-1',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toHaveLength(1);
    expect(state.runtime.resolvedApprovalIds).toEqual([]);
  });

  it('tracks compaction lifecycle directly from upstream agent events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-compact',
      stream: 'compaction',
      data: { phase: 'start', messages: ['Compacting context'] },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.compactionStatus).toEqual({
      phase: 'active',
      message: 'Compacting context',
    });
    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      status: expect.objectContaining({ kind: 'compaction', phase: 'active' }),
    }));

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-compact',
      stream: 'compaction',
      data: { phase: 'end', willRetry: true, completed: true },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.compactionStatus).toEqual({ phase: 'retrying' });
  });

  it('tracks manual session operation compaction events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      event: 'session.operation',
      payload: {
        operationId: 'operation-1',
        operation: 'compact',
        phase: 'start',
        sessionKey: 'agent:main:main',
        ts: 1000,
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.compactionStatus).toEqual({ phase: 'active' });
    expect(selectVisibleChatItems(state)).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      status: expect.objectContaining({ kind: 'compaction', phase: 'active' }),
    }));

    state = actionsFromAgentEvent({
      event: 'session.operation',
      payload: {
        operationId: 'operation-1',
        operation: 'compact',
        phase: 'end',
        sessionKey: 'agent:main:main',
        ts: 1001,
        completed: true,
        reason: 'manual compaction complete',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.compactionStatus).toEqual({
      phase: 'complete',
      message: 'manual compaction complete',
    });
  });

  it('tracks model fallback lifecycle directly from upstream agent events', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    const state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    const next = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-fallback',
      stream: 'fallback',
      data: {
        phase: 'start',
        decision: 'fallback_model',
        message: 'Trying fallback model',
      },
    }).reduce(chatCoreReducer, state);

    expect(next.runtime.fallbackStatus).toEqual({
      phase: 'active',
      message: 'Trying fallback model',
    });
    expect(selectVisibleChatItems(next)).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      status: expect.objectContaining({ kind: 'fallback', phase: 'active' }),
    }));
  });

  it('removes approval requests when upstream resolution events arrive', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'requested',
        status: 'pending',
        approvalId: 'approval-1',
        itemId: 'command:call-1',
        command: 'git status',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([
      expect.objectContaining({
        id: 'approval-1',
        itemId: 'command:call-1',
        status: 'pending',
      }),
    ]);

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      stream: 'approval',
      data: {
        phase: 'resolved',
        status: 'approved',
        approvalId: 'approval-1',
      },
    }).reduce(chatCoreReducer, state);

    expect(state.runtime.approvals).toEqual([]);
  });

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

  it('keeps a repeated queued prompt visible when the matching history message predates the send', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{ id: 'hist-user-old', role: 'user', content: 'repeat', timestamp: 1000 }],
      hasMore: false,
    });
    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-repeat-2',
        sessionKey: 'agent:main:main',
        message: 'repeat',
        idempotencyKey: 'idem-repeat-2',
        state: 'queued',
        createdAt: 1_500_000,
      } satisfies ChatQueueItem,
    });

    const items = selectVisibleChatItems(state);

    expect(items.filter((item) => item.kind === 'message')).toHaveLength(1);
    expect(items).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({ id: 'local-repeat-2', message: 'repeat' }),
    }));
  });

  it('keeps a repeated queued prompt visible when the previous matching user message was recent', () => {
    const createdAt = Date.UTC(2026, 5, 22, 0, 20, 0);
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{
        id: 'hist-user-one-minute-old',
        role: 'user',
        content: 'repeat-optimistic-probe',
        timestamp: createdAt - 60_000,
      }],
      hasMore: false,
    });
    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-repeat-current',
        sessionKey: 'agent:main:main',
        message: 'repeat-optimistic-probe',
        idempotencyKey: 'idem-repeat-current',
        state: 'queued',
        createdAt,
      } satisfies ChatQueueItem,
    });

    const items = selectVisibleChatItems(state);

    expect(items).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({
        id: 'local-repeat-current',
        message: 'repeat-optimistic-probe',
      }),
    }));
  });

  it('does not match a repeated queued prompt against a one-second-old history echo', () => {
    const createdAt = Date.UTC(2026, 5, 22, 0, 20, 0);
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{
        id: 'hist-user-one-second-old',
        role: 'user',
        content: 'repeat-within-skew',
        timestamp: createdAt - 1_000,
      }],
      hasMore: false,
    });
    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-repeat-within-skew',
        sessionKey: 'agent:main:main',
        message: 'repeat-within-skew',
        idempotencyKey: 'idem-repeat-within-skew',
        state: 'queued',
        createdAt,
      } satisfies ChatQueueItem,
    });

    const items = selectVisibleChatItems(state);

    expect(items).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({
        id: 'local-repeat-within-skew',
        message: 'repeat-within-skew',
      }),
    }));
  });

  it('does not match a queued prompt against history messages already present at enqueue time', () => {
    const createdAt = Date.UTC(2026, 5, 22, 0, 22, 0);
    const item = {
      id: 'local-repeat-after-fast-reply',
      sessionKey: 'agent:main:main',
      message: 'repeat-fast',
      idempotencyKey: 'idem-repeat-after-fast-reply',
      state: 'queued',
      createdAt,
      historyMessageCountAtEnqueue: 1,
    } as ChatQueueItem & { historyMessageCountAtEnqueue: number };
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{
        id: 'hist-user-fast-previous',
        role: 'user',
        content: 'repeat-fast',
        timestamp: createdAt - 1_000,
      }],
      hasMore: false,
    });
    state = chatCoreReducer(state, { type: 'send.enqueued', item });

    const items = selectVisibleChatItems(state);

    expect(items).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({ id: 'local-repeat-after-fast-reply' }),
    }));
  });

  it('matches a queued prompt against history messages added after enqueue time', () => {
    const createdAt = Date.UTC(2026, 5, 22, 0, 22, 0);
    const item = {
      id: 'local-repeat-server-echo',
      sessionKey: 'agent:main:main',
      message: 'repeat-fast',
      idempotencyKey: 'idem-repeat-server-echo',
      state: 'queued',
      createdAt,
      historyMessageCountAtEnqueue: 1,
    } as ChatQueueItem & { historyMessageCountAtEnqueue: number };
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item,
    });
    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'hist-user-fast-previous',
          role: 'user',
          content: 'repeat-fast',
          timestamp: createdAt - 1_000,
        },
        {
          id: 'hist-user-fast-current',
          role: 'user',
          content: 'repeat-fast',
          timestamp: createdAt + 1_000,
        },
      ],
      hasMore: false,
    });

    const items = selectVisibleChatItems(state);

    expect(items.some((visible) => (
      visible.kind === 'queue' && visible.item.id === 'local-repeat-server-echo'
    ))).toBe(false);
  });

  it('matches optimistic attachment prompts against media-suffixed history messages', () => {
    const initial = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const withQueued = chatCoreReducer(initial, {
      type: 'send.enqueued',
      item: {
        id: 'local-attachment',
        sessionKey: 'agent:main:main',
        message: 'sample.md',
        idempotencyKey: 'idem-attachment',
        state: 'queued',
      },
    });
    const loaded = chatCoreReducer(withQueued, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{
        id: 'hist-user-media',
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'sample.md',
              '',
              '[media attached: /tmp/sample.md (text/markdown) | /tmp/sample.md]',
            ].join('\n'),
          },
        ],
      }],
      hasMore: false,
    });

    const items = selectVisibleChatItems(loaded);

    expect(items.filter((item) => item.kind === 'message')).toHaveLength(1);
    expect(items.some((item) => item.kind === 'queue')).toBe(false);
  });

  it('collapses duplicated attachment user echoes while preserving the media-rich message', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'hist-user-media',
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'sample.md',
                '',
                '[media attached: /tmp/sample.md (text/markdown) | /tmp/sample.md]',
              ].join('\n'),
            },
          ],
        },
        { id: 'tool-read', role: 'assistant', content: [{ type: 'tool_use', id: 'read-1', name: 'read', input: { path: '/tmp/sample.md' } }] },
        { id: 'assistant-final', role: 'assistant', content: 'Done' },
        { id: 'hist-user-plain-duplicate', role: 'user', content: 'sample.md' },
      ],
      hasMore: false,
    });

    const userItems = selectVisibleChatItems(loaded).filter((item) => (
      item.kind === 'message' && item.message.role === 'user'
    ));

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toEqual(expect.objectContaining({
      id: 'hist-user-media',
      message: expect.objectContaining({ id: 'hist-user-media' }),
    }));
  });

  it('collapses attachment echoes when the plain echo is loaded before the media-rich message', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        { id: 'hist-user-plain-duplicate', role: 'user', content: 'sample.png' },
        {
          id: 'hist-user-media',
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'sample.png',
                '',
                '[media attached: /tmp/sample.png (image/png) | /tmp/sample.png]',
              ].join('\n'),
            },
          ],
        },
        { id: 'assistant-final', role: 'assistant', content: 'Done' },
      ],
      hasMore: false,
    });

    const userItems = selectVisibleChatItems(loaded).filter((item) => (
      item.kind === 'message' && item.message.role === 'user'
    ));

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toEqual(expect.objectContaining({
      id: 'hist-user-media',
      message: expect.objectContaining({ id: 'hist-user-media' }),
    }));
  });

  it('collapses duplicated user history messages with the same idempotency key', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'hist-user-original',
          role: 'user',
          content: 'after stop retry prompt',
          timestamp: 1_782_190_155_627,
          idempotencyKey: 'idem-after-stop:user',
        },
        {
          id: 'hist-user-duplicate',
          role: 'user',
          content: 'after stop retry prompt',
          timestamp: 1_782_190_155_627,
          idempotencyKey: 'idem-after-stop:user',
        },
        { id: 'assistant-aborted', role: 'assistant', content: 'aborted' },
      ],
      hasMore: false,
    });

    const userItems = selectVisibleChatItems(loaded).filter((item) => (
      item.kind === 'message' && item.message.role === 'user'
    ));

    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toEqual(expect.objectContaining({
      id: 'hist-user-original',
      message: expect.objectContaining({ id: 'hist-user-original' }),
    }));
  });

  it('keeps repeated user history messages when their idempotency keys differ', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'hist-user-repeat-1',
          role: 'user',
          content: 'same prompt twice',
          idempotencyKey: 'idem-repeat-1:user',
        },
        {
          id: 'hist-user-repeat-2',
          role: 'user',
          content: 'same prompt twice',
          idempotencyKey: 'idem-repeat-2:user',
        },
      ],
      hasMore: false,
    });

    const userItems = selectVisibleChatItems(loaded).filter((item) => (
      item.kind === 'message' && item.message.role === 'user'
    ));

    expect(userItems.map((item) => item.id)).toEqual([
      'hist-user-repeat-1',
      'hist-user-repeat-2',
    ]);
  });

  it('keeps the optimistic user prompt visible after send acknowledgement until history catches up', () => {
    const initial = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const enqueued = chatCoreReducer(initial, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'hello while running',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });
    const acked = chatCoreReducer(enqueued, {
      type: 'send.acked',
      id: 'local-1',
      runId: 'run-1',
    });

    expect(selectVisibleChatItems(acked)).toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({
        message: 'hello while running',
        state: 'sending',
      }),
    }));
  });

  it('keeps the optimistic user prompt before the live assistant stream for the same run', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'tell me a short story',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });
    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'local-1',
      runId: 'run-1',
    });
    state = chatCoreReducer(state, {
      type: 'chat.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'Once upon a time',
      ts: 1,
    });

    const itemKinds = selectVisibleChatItems(state).map((item) => item.kind);

    expect(itemKinds).toEqual(['queue', 'stream']);
  });

  it('keeps queued user text before a live assistant stream when the stream timestamp is earlier', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'send.enqueued',
      item: {
        id: 'local-sort-before-stream',
        sessionKey: 'agent:main:main',
        message: 'explain the failure',
        idempotencyKey: 'idem-sort-before-stream',
        state: 'queued',
      },
    });
    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'local-sort-before-stream',
      runId: 'run-sort-before-stream',
    });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-sort-before-stream',
      text: 'The failure is from...',
      phase: 'final_answer',
      ts: 0,
    });

    expect(selectVisibleChatItems(state).map((item) => item.kind)).toEqual(['queue', 'stream']);
  });

  it('hides heartbeat assistant messages from history visible items', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        { id: 'user-1', role: 'user', content: 'hello' },
        { id: 'heartbeat-1', role: 'assistant', content: 'HEARTBEAT_OK' },
        { id: 'assistant-1', role: 'assistant', content: 'visible reply' },
      ],
      hasMore: false,
    });

    expect(selectVisibleChatItems(loaded).map((item) => item.id)).toEqual([
      'user-1',
      'assistant-1',
    ]);
  });

  it('keeps gateway-injected assistant messages with visible text', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'user-think-command',
          role: 'user',
          content: '/think high',
        },
        {
          id: 'gateway-visible-error',
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Thinking level "high" is not supported for custom-customec/glm-5.2. Use one of: off.',
          }],
          model: 'gateway-injected',
          provider: 'openclaw',
          stopReason: 'stop',
        },
      ],
      hasMore: false,
    });

    expect(selectVisibleChatItems(loaded)).toEqual([
      expect.objectContaining({ kind: 'message', id: 'user-think-command' }),
      expect.objectContaining({ kind: 'message', id: 'gateway-visible-error' }),
    ]);
  });

  it('keeps media-only assistant history messages visible', () => {
    const mediaUrl = '/api/chat/media/outgoing/agent%3Amain%3Ahistory/history-image/full';
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [
        {
          id: 'a-media-only',
          role: 'assistant',
          content: [{ type: 'text', text: 'NO_REPLY' }],
          _attachedFiles: [
            {
              type: 'image',
              name: 'history-image.png',
              mediaUrl,
              mediaUrls: [mediaUrl],
            },
          ],
        },
      ],
      hasMore: false,
    });

    expect(selectVisibleChatItems(loaded)).toEqual([
      expect.objectContaining({
        kind: 'message',
        id: 'a-media-only',
        message: expect.objectContaining({
          _attachedFiles: [expect.objectContaining({ mediaUrls: [mediaUrl] })],
        }),
      }),
    ]);
  });

  it('emits thinking before phase-aware assistant history messages', () => {
    const loaded = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      messages: [{
        id: 'assistant-thinking-final',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Check the constraints first.' },
          {
            type: 'text',
            text: 'The final answer is ready.',
            textSignature: JSON.stringify({ v: 1, id: 'final-1', phase: 'final_answer' }),
          },
        ],
      }],
      hasMore: false,
    });

    const items = selectVisibleChatItems(loaded);
    expect(items.map((item) => item.kind)).toEqual(['thinking', 'message']);
    expect(items[0]).toEqual(expect.objectContaining({
      kind: 'thinking',
      id: 'thinking-assistant-thinking-final',
      text: 'Check the constraints first.',
    }));
    expect(items[1]).toEqual(expect.objectContaining({
      kind: 'message',
      id: 'assistant-thinking-final',
    }));
    if (items[1]?.kind !== 'message') throw new Error('expected assistant message item');
    expect(extractDisplayMessageText(items[1].message)).toBe('The final answer is ready.');
  });

  it('keeps live assistant tool command patch interleaving in timestamp order', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-live-order',
      stream: 'assistant',
      ts: 5000,
      data: { text: 'I will run a command.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-live-order',
      stream: 'tool',
      ts: 5001,
      data: {
        phase: 'start',
        toolCallId: 'call-stable-order',
        name: 'exec',
        args: { cmd: 'git status' },
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-live-order',
      stream: 'assistant',
      ts: 5002,
      data: { text: 'The command is running.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-live-order',
      stream: 'command_output',
      ts: 5003,
      data: {
        toolCallId: 'call-stable-order',
        output: 'clean',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-stable-live-order',
      stream: 'patch',
      ts: 5004,
      data: {
        toolCallId: 'call-stable-order',
        summary: 'No changes',
      },
    }).reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(state).map((item) => (
      item.kind === 'stream' ? `stream:${item.text}` : item.kind
    ))).toEqual([
      'stream:I will run a command.',
      'tool',
      'stream:The command is running.',
      'command',
      'patch',
    ]);
  });

  it('does not add duplicate live fallback text when history already has commentary text before a tool call', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-commentary-tool',
      stream: 'assistant',
      ts: 7000,
      data: {
        text: 'First explanation before search.',
        phase: 'commentary',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-commentary-tool',
      stream: 'tool',
      ts: 7001,
      data: {
        phase: 'start',
        toolCallId: 'call-commentary-tool',
        name: 'web_search',
        args: { query: 'tech trends' },
      },
    }).reduce(chatCoreReducer, state);

    state = chatCoreReducer(state, {
      type: 'history.loaded',
      sessionKey: 'agent:main:main',
      requestVersion: 1,
      hasMore: false,
      messages: [
        {
          id: 'assistant-tool-use-commentary',
          role: 'assistant',
          content: [
            { type: 'text', phase: 'commentary', text: 'First explanation before search.' },
            { type: 'toolCall', id: 'call-commentary-tool', name: 'web_search', input: { query: 'tech trends' } },
          ],
        },
        {
          id: 'tool-result-commentary',
          role: 'toolResult',
          toolCallId: 'call-commentary-tool',
          toolName: 'web_search',
          content: [{ type: 'text', text: 'search results' }],
        },
        {
          id: 'assistant-final-commentary',
          role: 'assistant',
          content: [{ type: 'text', phase: 'final_answer', text: 'Final explanation after search.' }],
        },
      ],
    });

    expect(state.history.messages).toHaveLength(3);
    expect(state.history.messages.map((message) => message.id)).toEqual([
      'assistant-tool-use-commentary',
      'tool-result-commentary',
      'assistant-final-commentary',
    ]);
  });

  it('keeps same-timestamp live items in event arrival order across kinds', async () => {
    const { actionsFromAgentEvent } = await import('@/chat-core/openclaw-port/events');
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-same-ts-live-order',
      seq: 1,
      stream: 'assistant',
      ts: 6000,
      data: { text: 'Assistant A.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-same-ts-live-order',
      seq: 2,
      stream: 'tool',
      ts: 6000,
      data: {
        phase: 'end',
        toolCallId: 'call-same-ts-order',
        name: 'read',
        result: 'contents',
      },
    }).reduce(chatCoreReducer, state);
    state = actionsFromAgentEvent({
      sessionKey: 'agent:main:main',
      runId: 'run-same-ts-live-order',
      seq: 3,
      stream: 'assistant',
      ts: 6000,
      data: { text: 'Assistant B.', phase: 'commentary' },
    }).reduce(chatCoreReducer, state);

    expect(selectVisibleChatItems(state).map((item) => (
      item.kind === 'stream' ? `stream:${item.text}` : item.kind
    ))).toEqual([
      'stream:Assistant A.',
      'tool',
      'stream:Assistant B.',
    ]);
  });

  it('filters hidden live assistant stream text', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });

    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-hidden-stream',
      text: 'HEARTBEAT_OK',
      phase: 'final_answer',
      ts: 1,
    });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-hidden-stream',
      text: 'NO_REPLY',
      phase: 'final_answer',
      ts: 2,
    });

    expect(selectVisibleChatItems(state).some((item) => item.kind === 'stream')).toBe(false);
  });

  it('does not show optimistic queue items from a previous session after switching sessions', () => {
    const initial = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    const enqueued = chatCoreReducer(initial, {
      type: 'send.enqueued',
      item: {
        id: 'local-1',
        sessionKey: 'agent:main:main',
        message: 'main session prompt',
        idempotencyKey: 'idem-1',
        state: 'queued',
      },
    });
    const switched = chatCoreReducer(enqueued, {
      type: 'session.changed',
      sessionKey: 'agent:main:other',
      selectedAgentId: 'main',
    });

    expect(selectVisibleChatItems(switched)).not.toContainEqual(expect.objectContaining({
      kind: 'queue',
      item: expect.objectContaining({ message: 'main session prompt' }),
    }));
  });

  it('does not surface terminal done status as a standalone chat row', () => {
    const state = chatCoreReducer(createInitialChatCoreState({ sessionKey: 'agent:main:main' }), {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
    });

    expect(selectVisibleChatItems(state).some((item) => (
      item.kind === 'status' && item.status.phase === 'done'
    ))).toBe(false);
  });

  it('does not let stale chat.final clear the active run', () => {
    const state = createActiveRunState('run-2');

    const next = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
    });

    expect(next.send.activeRunId).toBe('run-2');
    expect(next.send.canAbort).toBe(true);
    expect(next.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-2',
      text: 'run-2 active answer.',
    }));
    expect(next.runtime.runStatus).toBeNull();
  });

  it('does not let stale chat.error clear the active run', () => {
    const state = createActiveRunState('run-2');

    const next = chatCoreReducer(state, {
      type: 'chat.error',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      error: 'stale failure',
    });

    expect(next.send.activeRunId).toBe('run-2');
    expect(next.send.canAbort).toBe(true);
    expect(next.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-2',
      text: 'run-2 active answer.',
    }));
    expect(next.runtime.runStatus).toBeNull();
  });

  it('clears the active send state but keeps live output when matching chat.final arrives', () => {
    const state = createActiveRunState('run-2');

    const next = chatCoreReducer(state, {
      type: 'chat.final',
      sessionKey: 'agent:main:main',
      runId: 'run-2',
    });

    expect(next.send.activeRunId).toBeNull();
    expect(next.send.canAbort).toBe(false);
    expect(next.live.currentAssistant).toEqual(expect.objectContaining({
      runId: 'run-2',
      text: 'run-2 active answer.',
    }));
    expect(next.runtime.runStatus).toEqual({ phase: 'done', runId: 'run-2' });
  });

  it('clears the active run and stores the error when matching chat.error arrives', () => {
    const state = createActiveRunState('run-2');

    const next = chatCoreReducer(state, {
      type: 'chat.error',
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      error: 'matching failure',
    });

    expect(next.send.activeRunId).toBeNull();
    expect(next.send.canAbort).toBe(false);
    expect(next.live.currentAssistant).toBeNull();
    expect(next.runtime.runStatus).toEqual({
      phase: 'error',
      runId: 'run-2',
      message: 'matching failure',
    });
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

  it('clears live output on local abort and ignores late events from the aborted run', () => {
    let state = createInitialChatCoreState({ sessionKey: 'agent:main:main' });
    state = chatCoreReducer(state, {
      type: 'send.acked',
      id: 'send-1',
      runId: 'run-1',
    });
    state = chatCoreReducer(state, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'partial answer',
      phase: 'final_answer',
      ts: 1,
    });

    const aborted = chatCoreReducer(state, {
      type: 'send.aborted',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
    });
    const lateDelta = chatCoreReducer(aborted, {
      type: 'assistant.delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      text: 'late answer',
      phase: 'final_answer',
      ts: 2,
    });

    expect(selectVisibleChatItems(aborted).some((item) => item.kind === 'stream')).toBe(false);
    expect(lateDelta.live.currentAssistant).toBeNull();
    expect(selectVisibleChatItems(lateDelta).some((item) => item.kind === 'stream')).toBe(false);
    expect(lateDelta.send.sending).toBe(false);
    expect(lateDelta.send.activeRunId).toBeNull();
    expect(lateDelta.send.canAbort).toBe(false);
  });

  it('classifies recoverable send failures and sends queued items with idempotency', async () => {
    const { createQueueItem, isRecoverableSendError, sendQueuedItem } = await import(
      '@/chat-core/openclaw-port/send'
    );
    const request = vi.fn().mockResolvedValue({ runId: 'run-1' });
    const item = createQueueItem({
      id: 'queue-1',
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    });

    const result = await sendQueuedItem({ request }, item, { clawxStagedFiles: [], thinking: 'high' });

    expect(isRecoverableSendError(new Error('RPC timeout: chat.send'))).toBe(true);
    expect(isRecoverableSendError(new Error('validation failed'))).toBe(false);
    expect(result).toEqual({ runId: 'run-1' });
    expect(request).toHaveBeenCalledWith('chat.send', {
      clawxStagedFiles: [],
      thinking: 'high',
      sessionKey: 'agent:main:main',
      message: 'hello',
      deliver: false,
      idempotencyKey: 'idem-1',
    }, 120000);
  });
});

import { describe, expect, it } from 'vitest';
import { contentBlockToRenderPart, toolContentToRenderPart } from '@/lib/acp/content-blocks';
import { appendSyntheticAssistantMessage, applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';

describe('ACP timeline reducer', () => {
  it('segments assistant text when process blocks interleave with the same messageId', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'I will inspect this.' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'pending',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'The file is safe.' },
      },
    });

    expect(state.itemOrder).toEqual(['msg-a:0', 'tool:tool-1', 'msg-a:1']);
    expect(state.itemsById['msg-a:0']).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      segmentIndex: 0,
      parts: [{ kind: 'markdown', text: 'I will inspect this.' }],
    });
    expect(state.itemsById['msg-a:1']).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      segmentIndex: 1,
      parts: [{ kind: 'markdown', text: 'The file is safe.' }],
    });
  });

  it('keeps fallback message ids stable across chunks until a process block closes the segment', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'first' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' second' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'pending',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'after tool' },
      },
    });

    expect(state.itemOrder).toEqual(['assistant:message:0:0', 'tool:tool-1', 'assistant:message:2:0']);
    expect(state.itemsById['assistant:message:0:0']).toMatchObject({
      kind: 'message-segment',
      parts: [{ kind: 'markdown', text: 'first second' }],
    });
    expect(state.itemsById['assistant:message:2:0']).toMatchObject({
      kind: 'message-segment',
      parts: [{ kind: 'markdown', text: 'after tool' }],
    });
  });

  it('keeps fallback chunks interleaved when user and assistant messages omit ids', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'first user' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'first assistant' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'second user' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'second assistant' },
      },
    });

    expect(state.itemOrder).toEqual([
      'user:message:0:0',
      'assistant:message:1:0',
      'user:message:2:0',
      'assistant:message:3:0',
    ]);
    expect(state.itemsById['user:message:0:0']).toMatchObject({
      kind: 'message-segment',
      role: 'user',
      parts: [{ kind: 'markdown', text: 'first user' }],
    });
    expect(state.itemsById['user:message:2:0']).toMatchObject({
      kind: 'message-segment',
      role: 'user',
      parts: [{ kind: 'markdown', text: 'second user' }],
    });
  });

  it('coalesces adjacent markdown chunks into one render part', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'hello' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: ' world' },
      },
    });

    expect(state.itemOrder).toEqual(['msg-a:0']);
    expect(state.itemsById['msg-a:0']).toMatchObject({
      kind: 'message-segment',
      parts: [{ kind: 'markdown', text: 'hello world' }],
    });
  });

  it('replaces an optimistic user segment when ACP echoes the first chunk with the same id', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = {
      ...state,
      itemOrder: ['user-msg:0'],
      itemsById: {
        'user-msg:0': {
          kind: 'message-segment',
          id: 'user-msg:0',
          role: 'user',
          messageId: 'user-msg',
          segmentIndex: 0,
          optimistic: true,
          parts: [{ kind: 'markdown', text: 'hello' }],
        },
      },
      openMessageSegments: { 'user-msg': 'user-msg:0' },
      segmentCounts: { 'user-msg': 1 },
    };

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-msg',
        content: { type: 'text', text: 'hello' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-msg',
        content: { type: 'text', text: ' world' },
      },
    });

    expect(state.itemsById['user-msg:0']).toMatchObject({
      kind: 'message-segment',
      optimistic: false,
      parts: [{ kind: 'markdown', text: 'hello world' }],
    });
  });

  it('preserves optimistic attachment parts when ACP echoes only user text chunks', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = {
      ...state,
      itemOrder: ['user-msg:0'],
      itemsById: {
        'user-msg:0': {
          kind: 'message-segment',
          id: 'user-msg:0',
          role: 'user',
          messageId: 'user-msg',
          segmentIndex: 0,
          optimistic: true,
          parts: [
            { kind: 'markdown', text: 'inspect this' },
            { kind: 'file', path: '/repo/notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
          ],
        },
      },
      openMessageSegments: { 'user-msg': 'user-msg:0' },
      segmentCounts: { 'user-msg': 1 },
    };

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-msg',
        content: { type: 'text', text: 'inspect' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        messageId: 'user-msg',
        content: { type: 'text', text: ' this' },
      },
    });

    expect(state.itemsById['user-msg:0']).toMatchObject({
      kind: 'message-segment',
      optimistic: false,
      parts: [
        { kind: 'markdown', text: 'inspect this' },
        { kind: 'file', path: '/repo/notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
      ],
    });
  });

  it('preserves optimistic attachment parts when ACP echoes only a full user text message', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = {
      ...state,
      itemOrder: ['user-msg:0'],
      itemsById: {
        'user-msg:0': {
          kind: 'message-segment',
          id: 'user-msg:0',
          role: 'user',
          messageId: 'user-msg',
          segmentIndex: 0,
          optimistic: true,
          parts: [
            { kind: 'markdown', text: 'inspect this' },
            { kind: 'file', path: '/repo/notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
          ],
        },
      },
      openMessageSegments: { 'user-msg': 'user-msg:0' },
      segmentCounts: { 'user-msg': 1 },
    };

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message',
        messageId: 'user-msg',
        content: [{ type: 'text', text: 'inspect this' }],
      } as never,
    });

    expect(state.itemsById['user-msg:0']).toMatchObject({
      kind: 'message-segment',
      optimistic: false,
      parts: [
        { kind: 'markdown', text: 'inspect this' },
        { kind: 'file', path: '/repo/notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
      ],
    });
  });

  it('replaces an optimistic user segment when ACP echoes the first chunk without an id', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = {
      ...state,
      itemOrder: ['user-msg:0'],
      itemsById: {
        'user-msg:0': {
          kind: 'message-segment',
          id: 'user-msg:0',
          role: 'user',
          messageId: 'user-msg',
          segmentIndex: 0,
          optimistic: true,
          parts: [{ kind: 'markdown', text: 'hello' }],
        },
      },
      openMessageSegments: { 'user-msg': 'user-msg:0' },
      segmentCounts: { 'user-msg': 1 },
    };

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    });

    expect(state.itemsById['user-msg:0']).toMatchObject({
      kind: 'message-segment',
      optimistic: false,
      parts: [{ kind: 'markdown', text: 'hello' }],
    });
  });

  it('replaces message segment content on full message update', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'partial' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message',
        messageId: 'msg-a',
        content: [
          { type: 'text', text: 'complete' },
          { type: 'image', uri: 'file:///tmp/plot.png', data: 'ignored', mimeType: 'image/png' },
          { type: 'resource_link', uri: 'file:///tmp/result.txt', name: 'result.txt', mimeType: 'text/plain' },
        ],
      } as never,
    });

    const item = state.itemsById['msg-a:0'];
    expect(item).toMatchObject({ kind: 'message-segment', segmentIndex: 0 });
    if (item?.kind === 'message-segment') {
      expect(item.parts).toEqual([
        { kind: 'markdown', text: 'complete' },
        { kind: 'image', source: 'file:///tmp/plot.png', mimeType: 'image/png' },
        { kind: 'file', path: 'file:///tmp/result.txt', name: 'result.txt', mimeType: 'text/plain' },
      ]);
    }
  });

  it('adds full message content as a later segment after a process block closes the message', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'partial before tool' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'pending',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message',
        messageId: 'msg-a',
        content: [{ type: 'text', text: 'complete after tool' }],
      } as never,
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: ' trailing chunk' },
      },
    });

    expect(state.itemOrder).toEqual(['msg-a:0', 'tool:tool-1', 'msg-a:1']);
    expect(state.itemsById['msg-a:0']).toMatchObject({
      kind: 'message-segment',
      segmentIndex: 0,
      parts: [{ kind: 'markdown', text: 'partial before tool' }],
    });
    expect(state.itemsById['msg-a:1']).toMatchObject({
      kind: 'message-segment',
      segmentIndex: 1,
      parts: [{ kind: 'markdown', text: 'complete after tool trailing chunk' }],
    });
  });

  it('upserts tool calls, replaces update content, and appends content chunks', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Search',
        status: 'pending',
        content: [{ type: 'content', content: { type: 'text', text: 'initial output' } }],
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'in_progress',
        content: [{ type: 'diff', path: 'src/demo.ts', oldText: 'old', newText: 'new text' }],
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 'tool-1',
        content: { type: 'content', content: { type: 'text', text: 'found result' } },
      } as never,
    });

    expect(state.itemsById['tool:tool-1']).toMatchObject({
      kind: 'tool-call',
      status: 'running',
      outputParts: [
        { kind: 'markdown', text: 'Diff: src/demo.ts\n\nnew text' },
        { kind: 'markdown', text: 'found result' },
      ],
    });
  });

  it('appends marked synthetic assistant messages without faking ACP updates', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'live-msg',
        content: { type: 'text', text: 'Working...' },
      },
    });

    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png', alt: 'Generated image' },
      ],
    });

    expect(state.itemOrder).toEqual(['live-msg:0', 'compat:image-generation:task-1:0']);
    expect(state.openMessageSegments).toEqual({});
    expect(state.itemsById['compat:image-generation:task-1:0']).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      messageId: 'compat:image-generation:task-1',
      compat: { source: 'image-generation', evidenceId: 'evidence-1' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png' },
      ],
    });
  });

  it('updates an existing synthetic assistant message with the same id', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [{ kind: 'markdown', text: 'Generated image is ready.' }],
    });
    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [{ kind: 'markdown', text: 'Generated image is ready again.' }],
    });

    expect(state.itemOrder).toEqual(['compat:image-generation:task-1:0']);
    expect(state.itemsById['compat:image-generation:task-1:0']).toMatchObject({
      parts: [{ kind: 'markdown', text: 'Generated image is ready again.' }],
    });
  });

  it('converts embedded resources with a uri into file render parts', () => {
    expect(contentBlockToRenderPart({
      type: 'resource',
      resource: { uri: 'file:///tmp/report.md', text: '# Report', mimeType: 'text/markdown' },
    })).toEqual({ kind: 'file', path: 'file:///tmp/report.md', mimeType: 'text/markdown' });
  });

  it('prefers image data when an image uri is not render-safe', () => {
    expect(contentBlockToRenderPart({
      type: 'image',
      uri: '/tmp/staged-image.png',
      data: 'abc123',
      mimeType: 'image/png',
    })).toEqual({ kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png' });
  });

  it('returns an error render part for malformed embedded resources', () => {
    expect(contentBlockToRenderPart({ type: 'resource', resource: null } as never)).toEqual({
      kind: 'error',
      message: 'Unsupported ACP resource content',
    });
  });

  it('converts terminal tool content into a safe markdown render part', () => {
    expect(toolContentToRenderPart({ type: 'terminal', terminalId: 'terminal-1' })).toEqual({
      kind: 'markdown',
      text: 'Terminal: terminal-1',
    });
  });

  it('ignores notifications for other sessions', () => {
    const state = createEmptyAcpTimeline('agent:pi:s1', 1);

    const next = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s2',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'ignored' },
      },
    });

    expect(next).toBe(state);
    expect(next.itemOrder).toEqual([]);
  });

  it('updates session metadata for modes, session info, commands, and usage', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: { sessionUpdate: 'current_mode_update', currentModeId: 'code' },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'plan', description: 'Create a plan' }],
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: { sessionUpdate: 'session_info_update', title: 'Demo', updatedAt: '2026-07-05T00:00:00Z' },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: { sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 0.01, currency: 'USD' } },
    });

    expect(state.metadata).toEqual({
      currentModeId: 'code',
      availableCommands: [{ name: 'plan', description: 'Create a plan' }],
      title: 'Demo',
      updatedAt: '2026-07-05T00:00:00Z',
      usage: { used: 10, size: 100, cost: { amount: 0.01, currency: 'USD' } },
    });
  });

  it('updates metadata for config option updates', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    const configOptions = [
      {
        type: 'boolean',
        id: 'auto-approve',
        name: 'Auto approve safe tools',
        currentValue: false,
      },
    ];

    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: { sessionUpdate: 'config_option_update', configOptions },
    });

    expect(state.metadata.configOptions).toEqual(configOptions);
  });
});

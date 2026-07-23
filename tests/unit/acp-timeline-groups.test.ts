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
    expect(groups[1]).toMatchObject({ kind: 'assistant-turn', userMessageId: 'user-a' });
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['assistant-a:0']);
    expect(groups[3]).toMatchObject({ kind: 'assistant-turn', userMessageId: 'user-b' });
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
    expect(groups[0]).not.toHaveProperty('userMessageId');
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

  it('lifts ordered attachments from assistant messages, thoughts, and tool output', () => {
    const ref = { sessionKey: 'agent:main:session-1', generation: 1, uri: 'file:///workspace/file.txt' };
    const attachment = (attachmentId: string, name: string) => ({
      kind: 'attachment' as const,
      attachmentId,
      reference: { uri: ref.uri, name },
      source: 'acp-resource' as const,
      access: {
        status: 'available' as const,
        identity: `opaque-${attachmentId}`,
        target: { kind: 'local' as const, scope: 'workspace' as const, ref },
        mimeType: 'text/plain',
        size: 12,
      },
    });
    const groups = groupAcpTimelineItems(timelineWithItems({
      'assistant-a:0': {
        kind: 'message-segment', id: 'assistant-a:0', role: 'assistant', messageId: 'assistant-a', segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Message body' }, attachment('message-file', 'message.txt')],
      },
      'thought:assistant-a': {
        kind: 'thought', id: 'thought:assistant-a', messageId: 'assistant-a',
        parts: [attachment('thought-file', 'thought.txt'), { kind: 'markdown', text: 'Thought body' }],
      },
      'tool:read': {
        kind: 'tool-call', id: 'tool:read', toolCallId: 'read', title: 'Read file', status: 'completed', historical: true,
        outputParts: [{ kind: 'markdown', text: 'Tool body' }, attachment('tool-file', 'tool.txt')], locations: [],
      },
    }));

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.kind).toBe('assistant-turn');
    if (!group || group.kind !== 'assistant-turn') throw new Error('expected assistant group');
    expect(group.attachments.map((part) => part.attachmentId)).toEqual(['message-file', 'thought-file', 'tool-file']);
    expect(group.items[0]).toMatchObject({ parts: [{ kind: 'markdown', text: 'Message body' }] });
    expect(group.items[1]).toMatchObject({ parts: [{ kind: 'markdown', text: 'Thought body' }] });
    expect(group.items[2]).toMatchObject({ outputParts: [{ kind: 'markdown', text: 'Tool body' }] });
  });

  it('lifts user attachments across segments while retaining every prose segment first', () => {
    const ref = { sessionKey: 'agent:main:session-1', generation: 1, uri: 'file:///workspace/file.txt' };
    const attachment = (attachmentId: string, name: string) => ({
      kind: 'attachment' as const,
      attachmentId,
      reference: { uri: ref.uri, name },
      source: 'acp-resource' as const,
      access: {
        status: 'available' as const,
        identity: `opaque-${attachmentId}`,
        target: { kind: 'local' as const, scope: 'staging' as const, ref },
        mimeType: 'text/plain',
        size: 12,
      },
    });
    const groups = groupAcpTimelineItems(timelineWithItems({
      'user-a:0': {
        kind: 'message-segment', id: 'user-a:0', role: 'user', messageId: 'user-a', segmentIndex: 0,
        parts: [attachment('user-file-a', 'a.txt'), { kind: 'markdown', text: 'First prose' }],
      },
      'user-a:1': {
        kind: 'message-segment', id: 'user-a:1', role: 'user', messageId: 'user-a', segmentIndex: 1,
        parts: [{ kind: 'markdown', text: 'Second prose' }, attachment('user-file-b', 'b.txt')],
      },
    }));

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.kind).toBe('user');
    if (!group || group.kind !== 'user') throw new Error('expected user group');
    expect(group.items.map((item) => item.parts)).toEqual([
      [{ kind: 'markdown', text: 'First prose' }],
      [{ kind: 'markdown', text: 'Second prose' }],
    ]);
    expect(group.attachments.map((part) => part.attachmentId)).toEqual(['user-file-a', 'user-file-b']);
  });

  it('keeps a marked compatibility attachment visible when the turn has no ordinary assistant message', () => {
    const ref = { sessionKey: 'agent:main:session-1', generation: 1, uri: '/workspace/report.pdf' };
    const groups = groupAcpTimelineItems(timelineWithItems({
      'user-report:0': {
        kind: 'message-segment', id: 'user-report:0', role: 'user', messageId: 'user-report', segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Create report' }],
      },
      'compat:openclaw-media:evidence:0': {
        kind: 'message-segment',
        id: 'compat:openclaw-media:evidence:0',
        role: 'assistant',
        messageId: 'compat:openclaw-media:evidence',
        segmentIndex: 0,
        compat: { source: 'openclaw-media', evidenceId: 'evidence' },
        parts: [{
          kind: 'attachment',
          attachmentId: 'report',
          reference: { uri: ref.uri, name: 'report.pdf' },
          source: 'openclaw-media',
          evidenceId: 'evidence',
          access: {
            status: 'available', identity: 'opaque-report', mimeType: 'application/pdf', size: 12,
            target: { kind: 'local', scope: 'workspace', ref },
          },
        }],
      },
    }));

    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({
      kind: 'assistant-turn',
      items: [],
      attachments: [{ attachmentId: 'report', source: 'openclaw-media' }],
    });
  });
});

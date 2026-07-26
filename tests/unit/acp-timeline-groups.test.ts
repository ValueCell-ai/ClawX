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

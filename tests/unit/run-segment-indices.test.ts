import { describe, expect, it } from 'vitest';
import { buildRunSegmentMessageIndices } from '@/pages/Chat/task-visualization';
import type { RawMessage } from '@/stores/chat';

describe('buildRunSegmentMessageIndices', () => {
  it('marks assistant messages between real user turns', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'exec', input: {} }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'image', input: {} }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      { role: 'user', content: 'follow up' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ];
    const nextUserMessageIndexes = [4, -1, -1, -1, -1, -1];
    const indices = buildRunSegmentMessageIndices(
      messages,
      nextUserMessageIndexes,
      (message) => message.role === 'user',
    );

    expect(indices.has(1)).toBe(true);
    expect(indices.has(2)).toBe(true);
    expect(indices.has(3)).toBe(true);
    expect(indices.has(5)).toBe(true);
    expect(indices.has(0)).toBe(false);
    expect(indices.has(4)).toBe(false);
  });

  it('folds leading assistant orphans before the first user in a paginated suffix', () => {
    const messages: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'exec', input: {} }] },
      { role: 'assistant', content: [{ type: 'toolCall', id: 't2', name: 'image', input: {} }] },
      { role: 'user', content: 'question fell off the earlier page' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    const nextUserMessageIndexes = [-1, -1, -1, -1];
    const indices = buildRunSegmentMessageIndices(
      messages,
      nextUserMessageIndexes,
      (message) => message.role === 'user',
    );

    expect(indices.has(0)).toBe(true);
    expect(indices.has(1)).toBe(true);
    expect(indices.has(3)).toBe(true);
    expect(indices.has(2)).toBe(false);
  });
});

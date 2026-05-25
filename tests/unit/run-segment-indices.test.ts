import { describe, expect, it } from 'vitest';
import {
  buildRunSegmentMessageIndices,
  findReplyMessageIndex,
  getPostTriggerSegmentMessages,
  getRunSegmentMessages,
  hasActiveStreamingReplyInRun,
  segmentHasFinalReply,
} from '@/pages/Chat/task-visualization';
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

describe('getPostTriggerSegmentMessages vs getRunSegmentMessages', () => {
  const isUser = (message: RawMessage) => message.role === 'user';

  it('keeps lifecycle segment empty while graph segment includes paginated orphans', () => {
    const messages: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'prior answer' }] },
      { role: 'user', content: 'follow up' },
    ];

    expect(getPostTriggerSegmentMessages(messages, 1, -1)).toEqual([]);
    expect(getRunSegmentMessages(messages, 1, -1, isUser)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'prior answer' }] },
    ]);
  });

  it('does not attach a prior turn assistant when an earlier user exists in the window', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      { role: 'user', content: 'second' },
    ];

    expect(getPostTriggerSegmentMessages(messages, 2, -1)).toEqual([]);
    expect(getRunSegmentMessages(messages, 2, -1, isUser)).toEqual([]);
  });
});

describe('segmentHasFinalReply', () => {
  it('returns true when a text reply follows all tool calls', () => {
    const segment: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'exec', input: {} }] },
      { role: 'assistant', content: [{ type: 'text', text: '执行完成 ✅' }] },
    ];
    expect(segmentHasFinalReply(segment)).toBe(true);
  });

  it('returns false for narration before tools while the chain is still open', () => {
    const segment: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'Let me fetch that.' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'exec', input: {} }] },
    ];
    expect(segmentHasFinalReply(segment)).toBe(false);
  });
});

describe('findReplyMessageIndex / hasActiveStreamingReplyInRun', () => {
  it('protects a history reply from fold when the run is open but not streaming', () => {
    const postTrigger: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: '你好，我在。' }] },
    ];

    expect(hasActiveStreamingReplyInRun(true, false, null)).toBe(false);
    expect(findReplyMessageIndex(postTrigger, false)).toBe(0);
    expect(findReplyMessageIndex(postTrigger, true)).toBe(-1);
  });

  it('folds history when a stream bubble is active', () => {
    const postTrigger: RawMessage[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
    ];

    expect(hasActiveStreamingReplyInRun(true, true, null)).toBe(true);
    expect(findReplyMessageIndex(postTrigger, true)).toBe(-1);
  });
});

import { describe, expect, it } from 'vitest';
import { parseUsageEntriesFromJsonl } from '@electron/utils/token-usage-core';

describe('parseUsageEntriesFromJsonl', () => {
  it('extracts assistant usage entries in reverse chronological order', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-5',
          provider: 'openai',
          usage: {
            input: 100,
            output: 50,
            total: 150,
            cost: { total: 0.0012 },
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:05:00.000Z',
        message: {
          role: 'assistant',
          modelRef: 'claude-sonnet',
          provider: 'anthropic',
          usage: {
            promptTokens: 200,
            completionTokens: 80,
            cacheRead: 25,
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:06:00.000Z',
        message: {
          role: 'user',
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-02-28T10:05:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'claude-sonnet',
        provider: 'anthropic',
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 25,
        cacheWriteTokens: 0,
        totalTokens: 305,
        costUsd: undefined,
      },
      {
        timestamp: '2026-02-28T10:00:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'gpt-5',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        costUsd: 0.0012,
      },
    ]);
  });

  it('skips lines without assistant usage', () => {
    const jsonl = [
      JSON.stringify({ type: 'message', timestamp: '2026-02-28T10:00:00.000Z', message: { role: 'assistant' } }),
      JSON.stringify({ type: 'message', timestamp: '2026-02-28T10:01:00.000Z', message: { role: 'user', usage: { total: 123 } } }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([]);
  });
});

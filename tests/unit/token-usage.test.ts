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
        usageStatus: 'available',
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
        usageStatus: 'available',
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

  it('still skips tool result entries without usage payload', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T02:17:04.057Z',
        message: {
          role: 'toolResult',
          toolName: 'web_search',
          details: {
            provider: 'kimi',
            model: 'moonshot-v1-128k',
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([]);
  });

  it('keeps assistant usage entries with zero total tokens when usage is explicitly provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T03:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'moonshot',
          usage: {
            total: 0,
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T03:00:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'kimi-k2.6',
        provider: 'moonshot',
        usageStatus: 'available',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: undefined,
      },
    ]);
  });

  it('extracts usage fields from snake_case provider payloads', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T03:10:00.000Z',
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'moonshot',
          usage: {
            input_tokens: 12,
            output_tokens: 3,
            cache_read: 4,
            cache_write: 1,
            total_tokens: 20,
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T03:10:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'kimi-k2.6',
        provider: 'moonshot',
        usageStatus: 'available',
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 1,
        totalTokens: 20,
        costUsd: undefined,
      },
    ]);
  });

  it('supports tool result usage data without explicit provider/model keys', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T03:20:00.000Z',
        message: {
          role: 'toolResult',
          details: {
            usage: {
              input_tokens: 10,
              output_tokens: 20,
            },
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T03:20:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        usageStatus: 'available',
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 30,
        costUsd: undefined,
      },
    ]);
  });

  it('uses tool result usage when provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T02:17:04.057Z',
        message: {
          role: 'toolResult',
          details: {
            provider: 'kimi',
            model: 'moonshot-v1-128k',
            usage: {
              promptTokens: 120,
              completionTokens: 30,
              cacheRead: 10,
              totalTokens: 160,
              cost: { total: 0.0009 },
            },
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T02:17:04.057Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'moonshot-v1-128k',
        provider: 'kimi',
        usageStatus: 'available',
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        totalTokens: 160,
        costUsd: 0.0009,
      },
    ]);
  });

  it('extracts assistant response text into content', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T02:20:04.057Z',
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'moonshot',
          content: [{ type: 'text', text: '这是一条测试回复内容。' }],
          usage: {
            totalTokens: 100,
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T02:20:04.057Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'kimi-k2.6',
        provider: 'moonshot',
        usageStatus: 'available',
        content: '这是一条测试回复内容。',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 100,
        costUsd: undefined,
      },
    ]);
  });

  it('extracts tool result details content into content', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T02:21:04.057Z',
        message: {
          role: 'toolResult',
          details: {
            provider: 'kimi',
            model: 'moonshot-v1-128k',
            content: '外部搜索原文内容',
            usage: {
              totalTokens: 50,
            },
          },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T02:21:04.057Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'moonshot-v1-128k',
        provider: 'kimi',
        usageStatus: 'available',
        content: '外部搜索原文内容',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 50,
        costUsd: undefined,
      },
    ]);
  });

  it('maps usage object with no recognized fields to missing state', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T03:30:00.000Z',
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'moonshot',
          usage: { notes: 'tool call' },
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T03:30:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'kimi-k2.6',
        provider: 'moonshot',
        usageStatus: 'missing',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: undefined,
      },
    ]);
  });

  it('marks non-object usage payload as error', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-10T03:40:00.000Z',
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'moonshot',
          usage: 'invalid',
        },
      }),
    ].join('\n');

    expect(parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' })).toEqual([
      {
        timestamp: '2026-03-10T03:40:00.000Z',
        sessionId: 'abc',
        agentId: 'default',
        model: 'kimi-k2.6',
        provider: 'moonshot',
        usageStatus: 'error',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costUsd: undefined,
      },
    ]);
  });

  it('returns all matching entries when no limit is provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: { role: 'assistant', model: 'm1', usage: { total: 10 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:01:00.000Z',
        message: { role: 'assistant', model: 'm2', usage: { total: 20 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:02:00.000Z',
        message: { role: 'assistant', model: 'm3', usage: { total: 30 } },
      }),
    ].join('\n');

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' });
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.model)).toEqual(['m3', 'm2', 'm1']);
  });

  it('still supports explicit limits when provided', () => {
    const jsonl = [
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:00:00.000Z',
        message: { role: 'assistant', model: 'm1', usage: { total: 10 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:01:00.000Z',
        message: { role: 'assistant', model: 'm2', usage: { total: 20 } },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-02-28T10:02:00.000Z',
        message: { role: 'assistant', model: 'm3', usage: { total: 30 } },
      }),
    ].join('\n');

    const entries = parseUsageEntriesFromJsonl(jsonl, { sessionId: 'abc', agentId: 'default' }, 2);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.model)).toEqual(['m3', 'm2']);
  });
});

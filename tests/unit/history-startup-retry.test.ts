import { describe, expect, it } from 'vitest';
import { classifyHistoryStartupRetryError } from '@/stores/chat/history-startup-retry';

describe('history startup retry classification', () => {
  it('treats dotted and colon chat history timeout names as retryable timeouts', () => {
    expect(classifyHistoryStartupRetryError(new Error('RPC timeout: chat.history'))).toBe('timeout');
    expect(classifyHistoryStartupRetryError(new Error('RPC timeout: chat:history'))).toBe('timeout');
    expect(classifyHistoryStartupRetryError(new Error('Gateway RPC timeout: chat:history'))).toBe('timeout');
    expect(classifyHistoryStartupRetryError(new Error('Gateway WS timeout: chat:history'))).toBe('timeout');
  });
});

import { describe, expect, it } from 'vitest';
import {
  gatewayHistoryNeedsTranscriptHydration,
  isTruncatedHistoryText,
  mergeGatewayHistoryWithTranscript,
} from '@/stores/chat/history-transcript-merge';
import type { RawMessage } from '@/stores/chat/types';

describe('history-transcript-merge', () => {
  it('detects OpenClaw truncation markers', () => {
    expect(isTruncatedHistoryText('hello\n...(truncated)...')).toBe(true);
    expect(isTruncatedHistoryText('hello\n…(truncated)…')).toBe(true);
    expect(isTruncatedHistoryText('[chat.history omitted: message too large]')).toBe(true);
    expect(isTruncatedHistoryText('complete response')).toBe(false);
  });

  it('merges full transcript text over truncated gateway history', () => {
    const gatewayMessages: RawMessage[] = [{
      id: 'm1',
      role: 'assistant',
      content: `${'a'.repeat(100)}\n...(truncated)...`,
      timestamp: 1000,
    }];
    const transcriptMessages: RawMessage[] = [{
      id: 'm1',
      role: 'assistant',
      content: 'a'.repeat(500),
      timestamp: 1000,
    }];

    expect(gatewayHistoryNeedsTranscriptHydration(gatewayMessages)).toBe(true);
    const merged = mergeGatewayHistoryWithTranscript(gatewayMessages, transcriptMessages);
    expect(merged[0]?.content).toBe('a'.repeat(500));
    expect(gatewayHistoryNeedsTranscriptHydration(merged)).toBe(false);
  });

  it('leaves non-truncated gateway messages unchanged', () => {
    const gatewayMessages: RawMessage[] = [{
      role: 'assistant',
      content: 'short reply',
      timestamp: 1000,
    }];
    const transcriptMessages: RawMessage[] = [{
      role: 'assistant',
      content: 'different reply',
      timestamp: 1000,
    }];

    expect(mergeGatewayHistoryWithTranscript(gatewayMessages, transcriptMessages)).toEqual(gatewayMessages);
  });
});

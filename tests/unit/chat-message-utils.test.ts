import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatMessageAnchorId, formatTimestamp } from '@/pages/Chat/message-utils';

describe('chat message utils', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('formats relative timestamps using the active browser locale', () => {
    vi.setSystemTime(new Date('2026-06-22T10:00:00Z'));
    vi.stubGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN'] });

    expect(formatTimestamp(Date.parse('2026-06-22T09:59:40Z'))).toBe('刚刚');
    expect(formatTimestamp(Date.parse('2026-06-22T09:55:00Z'))).toContain('5');
    expect(formatTimestamp(Date.parse('2026-06-22T09:55:00Z'))).not.toContain('ago');
  });

  it('builds stable DOM-safe chat message anchors from protocol ids', () => {
    expect(chatMessageAnchorId('message 你好/42')).toBe('chat-message-anchor-message%20%E4%BD%A0%E5%A5%BD%2F42');
    expect(chatMessageAnchorId('  ')).toBeUndefined();
    expect(chatMessageAnchorId(null)).toBeUndefined();
  });
});

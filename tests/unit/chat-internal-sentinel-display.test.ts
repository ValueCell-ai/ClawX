import { describe, expect, it } from 'vitest';
import { extractText, extractTextSegments, stripInternalSentinelLines } from '@/pages/Chat/message-utils';

describe('internal sentinel display cleanup', () => {
  it('drops a trailing NO_REPLY appended after a real reply', () => {
    const text = [
      '今天杭州闷热潮湿，出门带把伞比较稳妥～',
      '',
      '如有需要我进一步深挖某条 AI 新闻的详情，可以告诉我！',
      '',
      'NO_REPLY',
    ].join('\n');

    expect(extractText({ role: 'assistant', content: text })).toBe(
      ['今天杭州闷热潮湿，出门带把伞比较稳妥～', '', '如有需要我进一步深挖某条 AI 新闻的详情，可以告诉我！'].join('\n'),
    );
  });

  it('drops a trailing HEARTBEAT_OK and is case-insensitive', () => {
    const text = 'All done.\nheartbeat_ok';
    expect(extractText({ role: 'assistant', content: text })).toBe('All done.');
  });

  it('still returns empty for a whole-message sentinel', () => {
    expect(extractText({ role: 'assistant', content: 'NO_REPLY' })).toBe('');
  });

  it('does not strip the token when embedded mid-sentence', () => {
    const text = 'The constant NO_REPLY signals a skipped turn.';
    expect(extractText({ role: 'assistant', content: text })).toBe(text);
  });

  it('removes sentinel-only segments from extractTextSegments', () => {
    const message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Here is the weather summary.' },
        { type: 'text', text: 'NO_REPLY' },
      ],
    };
    expect(extractTextSegments(message)).toEqual(['Here is the weather summary.']);
  });

  it('stripInternalSentinelLines leaves clean text untouched', () => {
    expect(stripInternalSentinelLines('Hello world')).toBe('Hello world');
  });
});

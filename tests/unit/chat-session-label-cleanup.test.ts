import { describe, expect, it } from 'vitest';
import { cleanSessionLabelText, toSessionLabel } from '@/stores/chat/session-label-cleanup';

describe('session label cleanup', () => {
  it('removes media attachment markers and message ids', () => {
    expect(cleanSessionLabelText(
      '看这张图 [media attached: /tmp/shot.png (image/png) | /tmp/shot.png] [message_id: abc]',
    )).toBe('看这张图');
  });

  it('removes already-truncated media markers from cached labels', () => {
    expect(cleanSessionLabelText(
      '手测图片附件：请描述这张 1x1 测试图片，简短回答。 [media attach…',
    )).toBe('手测图片附件：请描述这张 1x1 测试图片，简短回答。');
  });

  it('collapses metadata and truncates after cleanup', () => {
    const raw = [
      'Sender (untrusted metadata): someone',
      '这是一个很长的会话标题，用于验证附件协议串被移除之后才进行截断 [media attached: /tmp/a.txt (text/plain) | /tmp/a.txt]',
    ].join('\n');

    expect(toSessionLabel(raw, 12)).toBe('这是一个很长的会话标题，…');
  });
});

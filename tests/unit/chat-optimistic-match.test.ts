import { describe, expect, it } from 'vitest';
import { matchesOptimisticUserMessage } from '@/stores/chat/helpers';

describe('matchesOptimisticUserMessage', () => {
  it('文本完全一致时应匹配', () => {
    const optimistic = { role: 'user', content: '执行github1', timestamp: 1_700_000_000 } as const;
    const candidate = { role: 'user', content: '执行github1', timestamp: 1_700_000_000 } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('服务端回显包含 Gateway 注入的星期/时间前缀时应匹配', () => {
    const optimistic = { role: 'user', content: '执行github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] 执行github1',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('服务端追加 [media attached: ...] 引用时应匹配', () => {
    const optimistic = {
      role: 'user',
      content: '描述这张图片',
      timestamp: 1_700_000_000,
      _attachedFiles: [
        {
          fileName: 'shot.png',
          mimeType: 'image/png',
          fileSize: 123,
          preview: null,
          filePath: '/tmp/shot.png',
        },
      ],
    } as const;
    const candidate = {
      role: 'user',
      content: '描述这张图片\n\n[media attached: /tmp/shot.png (image/png) | /tmp/shot.png]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('服务端在用户消息中混入 [message_id: ...] 标签时应匹配', () => {
    const optimistic = { role: 'user', content: '你好世界', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '你好世界 [message_id: 11111111-2222-3333-4444-555555555555]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('对完全不相关的用户消息仍应返回 false', () => {
    const optimistic = { role: 'user', content: '执行github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] 完全不同的内容',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(false);
  });
});

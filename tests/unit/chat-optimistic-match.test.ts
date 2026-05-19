import { describe, expect, it } from 'vitest';
import {
  dropRedundantOptimisticUserMessages,
  hasOptimisticServerEcho,
  matchesOptimisticUserMessage,
  mergePendingOptimisticUserMessages,
  rememberPendingOptimisticUserMessage,
} from '@/stores/chat/helpers';

describe('matchesOptimisticUserMessage', () => {
  it('matches when text is identical', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when Gateway prefixes a weekday/timestamp prefix on the echoed user message', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] run github1',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when the server appends [media attached: ...] to the echoed user message', () => {
    const optimistic = {
      role: 'user',
      content: 'Describe this image',
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
      content: 'Describe this image\n\n[media attached: /tmp/shot.png (image/png) | /tmp/shot.png]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when the server strips a [message_id: ...] tag from the user message', () => {
    const optimistic = { role: 'user', content: 'hello world', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: 'hello world [message_id: 11111111-2222-3333-4444-555555555555]',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('matches when Gateway echo timestamp skews within the optimistic window', () => {
    const optimistic = { role: 'user', content: '你好，你是什么模型', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '你好，你是什么模型',
      timestamp: 1_700_000_030,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });

  it('rejects unrelated user messages when timestamp skew is too large', () => {
    const optimistic = { role: 'user', content: '你好，你是什么模型', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '你好，你是什么模型',
      timestamp: 1_700_030_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(false);
  });

  it('still rejects unrelated user messages', () => {
    const optimistic = { role: 'user', content: 'run github1', timestamp: 1_700_000_000 } as const;
    const candidate = {
      role: 'user',
      content: '[Wed 2026-04-22 10:30 GMT+8] completely different text',
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(false);
  });

  // Regression for the duplicate-bubble bug reproduced in session
  // fa07a446-c107-4252-9948-c063357647bc.jsonl: the Gateway echo carries a
  // Sender block, one or more `[media attached: ...]` lines BEFORE the
  // `[Mon ... GMT+8]` timestamp prefix, the real user text, and a trailing
  // `[media attached: ...]` line. Earlier code stripped the timestamp
  // regex before the media-attached lines, so the timestamp anchor
  // `^\s*\[(?:Mon|...)]` never matched (the leading `[` was
  // `[media attached:`). The normalized comparison text kept the
  // `[Mon ...]` prefix and never equalled the bare optimistic text,
  // causing dedupe to miss and the message to render twice — the second
  // bubble showing the leftover `[Mon ...]` prefix.
  it('matches the full Gateway echo with Sender block, leading + trailing media lines, and a timestamp prefix', () => {
    const optimistic = {
      role: 'user',
      content: 'Please help me investigate why I am not getting a reply when I send messages on Discord. ClawX is now in connected status.',
      timestamp: 1_700_000_000,
      _attachedFiles: [
        {
          fileName: 'image---9ad2735c.png',
          mimeType: 'image/png',
          fileSize: 456,
          preview: null,
          filePath: '/Users/guoyuliang/.openclaw/media/inbound/image---9ad2735c-21ce-443e-af5c-1cd290c1d8d0.png',
        },
      ],
    } as const;
    const candidate = {
      role: 'user',
      content: [
        'Sender (untrusted metadata):',
        '```json',
        '{',
        '  "label": "ClawX (gateway-client)",',
        '  "id": "gateway-client",',
        '  "name": "ClawX",',
        '  "username": "ClawX"',
        '}',
        '```',
        '',
        '[media attached: /Users/guoyuliang/.openclaw/media/inbound/image---9ad2735c-21ce-443e-af5c-1cd290c1d8d0.png (image/png)]',
        '[Mon 2026-05-18 10:39 GMT+8] Please help me investigate why I am not getting a reply when I send messages on Discord. ClawX is now in connected status.',
        '[media attached: /Users/guoyuliang/.openclaw/media/outbound/fa3637d9-98b9-4e77-a176-3f66ca763cf4.png (image/png) | /Users/guoyuliang/.openclaw/media/outbound/fa3637d9-98b9-4e77-a176-3f66ca763cf4.png]',
      ].join('\n'),
      timestamp: 1_700_000_000,
    } as const;

    expect(matchesOptimisticUserMessage(candidate, optimistic, 1_700_000_000_000)).toBe(true);
  });
});

describe('optimistic user message merge', () => {
  it('drops redundant optimistic bubbles when history already contains the echoed user turn', () => {
    const sessionKey = 'agent:main:main';
    const optimistic = {
      id: 'local-optimistic',
      role: 'user' as const,
      content: '你好，你是什么模型',
      timestamp: 1_700_000_000,
    };
    rememberPendingOptimisticUserMessage(sessionKey, optimistic, 1_700_000_000_000);

    const merged = mergePendingOptimisticUserMessages(sessionKey, [
      {
        id: 'server-echo',
        role: 'user',
        content: '[Wed 2026-04-22 10:30 GMT+8] 你好，你是什么模型',
        timestamp: 1_700_000_015,
      },
    ]);
    const deduped = dropRedundantOptimisticUserMessages(sessionKey, merged);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe('server-echo');
    expect(hasOptimisticServerEcho(deduped, optimistic, 1_700_000_000_000)).toBe(true);
  });
});

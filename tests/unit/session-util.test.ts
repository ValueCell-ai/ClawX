import { describe, expect, it } from 'vitest';
import { getSessionDeliveryMetadata } from '../../electron/utils/session-util';

describe('persisted session delivery metadata', () => {
  it('reads canonical external metadata without mixing stale compatibility fields', () => {
    expect(getSessionDeliveryMetadata({
      delivery: {
        kind: 'external',
        context: { channel: 'openclaw-weixin', accountId: 'wx-new', to: 'CaseSensitive@im.wechat' },
        origin: { label: 'Recipient', chatType: 'direct' },
      },
      deliveryContext: { channel: 'telegram', accountId: 'old', to: 'wrong' },
      origin: { label: 'Stale recipient' },
      lastTo: 'also-wrong',
    })).toEqual({
      channel: 'openclaw-weixin', accountId: 'wx-new', to: 'CaseSensitive@im.wechat', label: 'Recipient', chatType: 'direct',
    });
  });

  it.each(['none', 'internal', 'unknown'])('does not resurrect legacy fields for canonical %s state', (kind) => {
    expect(getSessionDeliveryMetadata({
      delivery: { kind },
      deliveryContext: { channel: 'wechat', accountId: 'old', to: 'stale@im.wechat' },
    })).toEqual({});
  });

  it('uses canonical origin fallbacks without borrowing an account from legacy fields', () => {
    expect(getSessionDeliveryMetadata({
      delivery: { kind: 'external', origin: { provider: 'wechat', to: 'Peer@im.wechat' } },
      lastAccountId: 'unrelated',
    })).toMatchObject({ channel: 'wechat', to: 'Peer@im.wechat', accountId: undefined });
  });

  it('supports legacy deliveryContext, last-route and origin formats', () => {
    const expected = { channel: 'wechat', accountId: 'wx-old', to: 'Peer@im.wechat' };
    expect(getSessionDeliveryMetadata({ deliveryContext: expected })).toMatchObject(expected);
    expect(getSessionDeliveryMetadata({ lastChannel: 'wechat', lastAccountId: 'wx-old', lastTo: 'Peer@im.wechat' }))
      .toMatchObject(expected);
    expect(getSessionDeliveryMetadata({ origin: { provider: 'wechat', accountId: 'wx-old', to: 'Peer@im.wechat' } }))
      .toMatchObject(expected);
  });
});

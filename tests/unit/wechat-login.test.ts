// @vitest-environment node
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-wechat-login-${suffix}`,
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/clawx-test-user-data',
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp',
  },
}));

describe('wechat login utility', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
  });

  it('starts a QR session, waits for confirmation, and stores account state in the plugin path', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          qrcode: 'qr-token',
          qrcode_img_content: 'https://example.com/qr.png',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ status: 'wait' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'confirmed',
          bot_token: 'secret-token',
          ilink_bot_id: 'bot@im.bot',
          baseurl: 'https://ilinkai.weixin.qq.com',
          ilink_user_id: 'user-123',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const {
      saveWeChatAccountState,
      startWeChatLoginSession,
      waitForWeChatLoginSession,
    } = await import('@electron/utils/wechat-login');

    const startResult = await startWeChatLoginSession({});
    expect(startResult.qrcodeUrl).toMatch(/^data:image\/png;base64,/);
    expect(startResult.sessionKey).toBeTruthy();

    const waitResult = await waitForWeChatLoginSession({
      sessionKey: startResult.sessionKey,
      timeoutMs: 2_500,
    });
    expect(waitResult.connected).toBe(true);
    expect(waitResult.accountId).toBe('bot@im.bot');
    expect(waitResult.botToken).toBe('secret-token');

    const normalizedAccountId = await saveWeChatAccountState(waitResult.accountId!, {
      token: waitResult.botToken!,
      baseUrl: waitResult.baseUrl,
      userId: waitResult.userId,
    });

    expect(normalizedAccountId).toBe('bot-im-bot');

    const accountFile = JSON.parse(
      await readFile(join(testHome, '.openclaw', 'openclaw-weixin', 'accounts', 'bot-im-bot.json'), 'utf-8'),
    ) as { token?: string; baseUrl?: string; userId?: string };
    expect(accountFile.token).toBe('secret-token');
    expect(accountFile.baseUrl).toBe('https://ilinkai.weixin.qq.com');
    expect(accountFile.userId).toBe('user-123');

    const accountIndex = JSON.parse(
      await readFile(join(testHome, '.openclaw', 'openclaw-weixin', 'accounts.json'), 'utf-8'),
    ) as string[];
    expect(accountIndex).toEqual(['bot-im-bot']);
  });
});

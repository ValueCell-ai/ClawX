// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bundle = (relative: string) => import(pathToFileURL(resolve('node_modules', relative)).href);
const connector = '@tencent-weixin/openclaw-weixin/dist/src';
const { weixinPlugin } = await bundle(`${connector}/channel.js`);
const { setContextToken } = await bundle(`${connector}/messaging/inbound.js`);
const { d: retryability } = await bundle('openclaw/dist/delivery-recovery.shared-BsYT6VS9.mjs');
const { n: OutboundDeliveryError } = await bundle('openclaw/dist/deliver-types-ChQJdCfP.mjs');

const accountId = 'fixture-bot';
const to = 'CaseSensitive@im.wechat';
const context = { accountId, to, cfg: {}, text: 'scheduled result' };
const prepareFailed = { ret: -2, errmsg: 'prepare failed' };
const request = vi.fn<typeof fetch>();
let stateDir: string;

describe('Weixin scheduled text delivery', () => {
  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'clawx-weixin-retry-'));
    vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);
    vi.stubEnv('OPENCLAW_CONFIG_PATH', join(stateDir, 'openclaw.json'));
    vi.stubGlobal('fetch', request.mockReset());
    const accounts = join(stateDir, 'openclaw-weixin', 'accounts');
    await mkdir(accounts, { recursive: true });
    await writeFile(join(accounts, `${accountId}.json`), JSON.stringify({
      token: 'fixture-credential', baseUrl: 'https://ilink.invalid',
    }));
    setContextToken(accountId, to, 'original-context');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('proves a rejected send and uses the refreshed conversation token on the next attempt', async () => {
    request.mockResolvedValueOnce(Response.json(prepareFailed));
    const error = await weixinPlugin.outbound.sendText(context).catch((err: Error) => err);
    expect(retryability(error)).toBe(true);
    // A previous delivered chunk makes the batch ineligible for replay.
    expect(retryability(new OutboundDeliveryError(error.message, {
      cause: error, sentBeforeError: true,
    }))).toBeUndefined();

    setContextToken(accountId, to, 'refreshed-context');
    request.mockResolvedValueOnce(Response.json({ ret: 0, message_id: '123' }));
    await expect(weixinPlugin.outbound.sendText(context)).resolves.toMatchObject({
      channel: 'openclaw-weixin', messageId: expect.any(String),
    });

    expect(request).toHaveBeenCalledTimes(2);
    for (const [i, [url, init]] of request.mock.calls.entries()) {
      expect(url).toBe('https://ilink.invalid/ilink/bot/sendmessage');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-credential');
      const { msg } = JSON.parse(String(init?.body));
      expect(msg).toMatchObject({
        to_user_id: to,
        context_token: i === 0 ? 'original-context' : 'refreshed-context',
        item_list: [{ text_item: { text: context.text } }],
      });
    }
  });

  it.each([
    { ret: -2, errmsg: 'a different error' },
    { ret: -3, errmsg: 'prepare failed' },
    { ...prepareFailed, message_id: '123' },
  ])('leaves other server responses unclassified (%j)', async (response) => {
    request.mockResolvedValueOnce(Response.json(response));
    const error = await weixinPlugin.outbound.sendText(context).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect(retryability(error)).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('preserves uncertain transport and media outcomes', async () => {
    const transportError = new Error('sendMessage ret=-2 errmsg=prepare failed');
    request.mockRejectedValueOnce(transportError);
    await expect(weixinPlugin.outbound.sendText(context)).rejects.toBe(transportError);
    // sendMedia also has a plain-text fallback, but it does not own the sendText proof.
    request.mockResolvedValueOnce(Response.json(prepareFailed));
    const error = await weixinPlugin.outbound.sendMedia(context).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect(retryability(error)).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

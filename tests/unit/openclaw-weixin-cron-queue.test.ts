// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

const requireRuntime = createRequire(import.meta.url);
const bundled = (name: string) => requireRuntime(resolve('node_modules/openclaw/dist', name));

it('recovers a rejected cron notification using its durable delivery intent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clawx-weixin-queue-'));
  vi.stubEnv('OPENCLAW_HOME', home);
  vi.stubEnv('OPENCLAW_STATE_DIR', home);
  vi.stubEnv('OPENCLAW_CONFIG_PATH', join(home, 'openclaw.json'));
  vi.stubEnv('OPENCLAW_TEST_FAST', '1');
  const registry = bundled('registry-empty-mS6HujHb.mjs').t();
  const { C: setRegistry, n: snapshotRegistry, x: restoreRegistry } = bundled('runtime-DbAbpcIy.mjs');
  const connector = resolve('node_modules/@tencent-weixin/openclaw-weixin/dist/src');
  const { weixinPlugin } = requireRuntime(join(connector, 'channel.js'));
  const { setContextToken } = requireRuntime(join(connector, 'messaging/inbound.js'));
  const { sendCronAnnouncePayloadStrict } = bundled('delivery-47Zdb3F0.mjs');
  const { drainPendingDeliveries } = bundled('plugin-sdk/delivery-queue-runtime.js');
  const { m: loadUnfinishedDeliveries } = bundled('delivery-queue-storage-Aqg_oq1Q.mjs');
  const { l: closeDatabase } = bundled('openclaw-state-db-cache-SfxRpkii.mjs');
  const previous = snapshotRegistry();
  const channel = 'openclaw-weixin';
  const to = 'recipient@im.wechat';
  const accountId = 'test-bot';
  const cfg = { channels: { [channel]: { accounts: { [accountId]: { enabled: true } } } } };
  const requests = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe('https://ilink.invalid/ilink/bot/sendmessage');
    const { msg } = JSON.parse(String(init?.body));
    expect(msg.to_user_id).toBe(to);
    expect(msg.item_list[0].text_item.text).toBe('Synthetic reminder');
    return Response.json(msg.context_token === 'renewed'
      ? { ret: 0, message_id: '123' }
      : { ret: -2, errmsg: 'prepare failed' });
  });
  vi.stubGlobal('fetch', requests);
  registry.channels.push({ pluginId: channel, plugin: weixinPlugin });
  setRegistry(registry);
  try {
    const accounts = join(home, channel, 'accounts');
    await mkdir(accounts, { recursive: true });
    await writeFile(join(accounts, accountId + '.json'), JSON.stringify({
      token: 'synthetic-credential', baseUrl: 'https://ilink.invalid',
    }));
    setContextToken(accountId, to, 'previous');
    const send = () => sendCronAnnouncePayloadStrict({
      cfg, deps: {}, agentId: 'main', jobId: 'legacy-reminder', target: { to, accountId, channel },
      payload: [{ text: 'Synthetic reminder' }],
      completion: { runStartedAt: 1_800_000_000_000 }, abortSignal: new AbortController().signal,
    });
    await expect(send()).rejects.toMatchObject({
      message: 'sendMessage ret=-2 errmsg=prepare failed', sentBeforeError: false, queueCustody: 'held',
    });
    expect(requests).toHaveBeenCalledTimes(4);
    expect(await loadUnfinishedDeliveries(home)).toMatchObject([{ channel, to, accountId, retryCount: 4 }]);
    // A new inbound message updates this recipient's context. Only the platform response is mocked.
    setContextToken(accountId, to, 'renewed');
    await drainPendingDeliveries({
      cfg, stateDir: home, drainKey: channel, logLabel: 'test',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      selectEntry: () => ({ match: true, bypassBackoff: true }),
    });
    expect(requests).toHaveBeenCalledTimes(5);
    expect(await loadUnfinishedDeliveries(home)).toEqual([]);
    await expect(send()).resolves.toMatchObject({ status: 'sent', payloads: [] });
    expect(requests).toHaveBeenCalledTimes(5);
  } finally {
    restoreRegistry(previous);
    await closeDatabase(join(home, 'state', 'openclaw.sqlite'));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
}, 90_000);

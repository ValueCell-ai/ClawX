// Run in a separate, isolated Node process against the installed SDK. Do not
// start channel transports or use real account credentials in this contract.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { default: dingtalk } = await import(pathToFileURL(process.env.CLAWX_DINGTALK_ENTRY).href);
import wecom from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/index.js';
import weixin from '../../node_modules/@tencent-weixin/openclaw-weixin/dist/index.js';

const state = process.env.OPENCLAW_STATE_DIR;
assert.ok(state && state.includes('clawx-channel-contract-'));
let config = { channels: {
  'dingtalk': { enabled: true, accounts: {
    default: { clientId: 'ding-default', clientSecret: 'synthetic-ding-default' },
    support: { clientId: 'ding-support', clientSecret: 'synthetic-ding-support', enabled: false },
  } },
  wecom: { enabled: true, defaultAccount: 'default', accounts: {
    default: { botId: 'wecom-default', secret: 'synthetic-wecom-default' },
    support: { botId: 'wecom-support', secret: 'synthetic-wecom-support', enabled: false },
  } },
  'openclaw-weixin': { accounts: { 'fixture-im-bot': { name: 'Existing Weixin', enabled: true } } },
} };
const channels = new Map();
const methods = new Map();
const tools = [];
const routes = [];
let mutations = 0;
const api = {
  config, registrationMode: 'full',
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  runtime: { version: '2026.10.10', config: {
    current: () => config,
    async mutateConfigFile({ mutate }) {
      const draft = structuredClone(config);
      await mutate(draft);
      config = draft;
      mutations++;
    },
  } },
  registerChannel({ plugin }) { channels.set(plugin.id, plugin); },
  registerGatewayMethod(name, handler) { methods.set(name, handler); },
  registerTool(factory, options) { tools.push({ factory, options }); },
  registerHttpRoute(route) { routes.push(route); },
  on() {},
};
await dingtalk(api);
await wecom.register(api);
await weixin.register(api);
assert.deepEqual([...channels.keys()].sort(), ['dingtalk', 'openclaw-weixin', 'wecom']);
for (const id of ['dingtalk', 'wecom']) {
  const channel = channels.get(id);
  assert.deepEqual(channel.config.listAccountIds(config).sort(), ['default', 'support']);
  const main = channel.config.resolveAccount(config, 'default');
  const other = channel.config.resolveAccount(config, 'support');
  assert.equal(main.enabled, true);
  assert.equal(other.enabled, false);
  assert.equal(main.clientSecret ?? main.config?.clientSecret ?? main.secret, `synthetic-${id === 'wecom' ? 'wecom' : 'ding'}-default`);
  assert.equal(typeof channel.gateway.startAccount, 'function');
  assert.equal(typeof channel.outbound.sendText, 'function');
}
assert.ok(methods.has('dingtalk-connector.card.create'));
assert.ok(methods.size >= 3);
assert.ok(tools.some(tool => tool.options.name === 'wecom-cli'));
assert.equal(routes.length, 5);

// Current and pre-normalized QR login files both remain usable without login.
const accountsDir = join(state, 'openclaw-weixin/accounts');
await mkdir(accountsDir, { recursive: true });
const accountFile = join(accountsDir, 'fixture@im.bot.json');
const login = JSON.stringify({ token: 'synthetic-weixin-login', userId: 'user@im.wechat', baseUrl: 'https://ilinkai.weixin.qq.com' });
await writeFile(accountFile, login);
await writeFile(join(state, 'openclaw-weixin/accounts.json'), '["fixture@im.bot"]');
const wx = channels.get('openclaw-weixin');
assert.ok(wx.config.listAccountIds(config).includes('fixture@im.bot'));
const account = wx.config.resolveAccount(config, 'fixture-im-bot');
assert.equal(account.token, 'synthetic-weixin-login');
assert.equal(account.configured, true);
assert.equal(await readFile(accountFile, 'utf8'), login);

// 10.10 removed loadConfig/writeConfigFile. The new WeCom release must use the
// mutation API and preserve other accounts, even when its caller is stale.
const stale = structuredClone(config);
config.channels.wecom.accounts.support.secret = 'newer-other-account-secret';
assert.deepEqual(await channels.get('wecom').gateway.logoutAccount({ cfg: stale, accountId: 'default' }),
  { cleared: true, envToken: false, loggedOut: true });
assert.equal(mutations, 1);
assert.equal(config.channels.wecom.accounts.default?.secret, undefined);
assert.equal(config.channels.wecom.accounts.support.secret, 'newer-other-account-secret');
assert.equal(config.channels['dingtalk'].accounts.default.clientSecret, 'synthetic-ding-default');
console.log('DingTalk, WeCom and Weixin registration/account contracts passed on OpenClaw 2026.10.10');

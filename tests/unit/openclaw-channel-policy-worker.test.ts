// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const facade = 'user-channel-identities-CPNsazJx.mjs';
const schema = 'users-Dl5mHzAH.mjs';
const policyWorker = 'clawx-user-channel-policy.worker.mjs';
const policyStore = 'clawx-user-channel-policy-store.mjs';

async function runIsolated(source: string, flags: string[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'clawx-policy-worker-'));
  try {
    const state = path.join(root, 'state');
    const script = path.join(root, 'exercise.mjs');
    await writeFile(script, `
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const load = name => import(pathToFileURL(path.join(process.argv[2], name)).href);
mkdirSync(process.env.OPENCLAW_STATE_DIR, { recursive: true });
${source}
`);
    await promisify(execFile)(process.execPath, [...flags, script, dist], {
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENCLAW_|CLAWX_)/i.test(key))),
        HOME: root, USERPROFILE: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state,
        OPENCLAW_CONFIG_PATH: path.join(state, 'openclaw.json'),
        APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), TEMP: root, TMP: root,
        XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
        XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state-home'),
      },
      windowsHide: true,
      timeout: 90_000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('OpenClaw channel policy worker', () => {
  it('keeps the policy worker and its store during package cleanup', async () => {
    const inventory = JSON.parse(await readFile(path.join(dist, 'postinstall-inventory.json'), 'utf8'));
    expect(inventory).toEqual(expect.arrayContaining([`dist/${policyWorker}`, `dist/${policyStore}`]));
  });

  it('loads the policy worker without the sender schema and refuses unrelated commands before opening storage', async () => {
    await runIsolated(`
const files = [];
registerHooks({ load(url, context, next) { files.push(url); return next(url, context); } });
const { channelPolicyOperations } = await load('${policyWorker}');
assert(!files.some(url => url.endsWith('/${schema}') || url.includes('/typebox/build/')));
const publish = channelPolicyOperations['userProfiles.channelPolicy.publish'];
assert.deepEqual(Object.keys(channelPolicyOperations), ['userProfiles.channelPolicy.publish']);
const context = { open() { throw Error('Unexpected database open'); }, stateOptions() { throw Error('Unexpected state access'); } };
for (const input of [{action:'authorize'}, {action:'link'}, {action:'unlink'}, {action:'policy', identity:{}}]) {
  assert.throws(() => publish(input, context), /Invalid channel policy publication/);
}
const { userProfileOperations } = await load('user-profiles.worker-D_T6hArA.mjs');
const unadmitted = { open: () => ({ db: {} }), stateOptions: () => ({}) };
for (const dispatch of [publish, userProfileOperations['userProfiles.channelIdentity.change']]) {
  assert.throws(() => dispatch({ action: 'policy', policy: {} }, unadmitted), /requires its retained admission/);
}
`);
  }, 100_000);

  it.each([true, false])('validates identities during concurrent native imports with require(esm) enabled = %s', async (enabled) => {
    await runIsolated(`
const { p: subject } = await load('${facade}');
const require = createRequire(pathToFileURL(path.join(process.argv[2], '${facade}')));
const loading = Promise.all([import(pathToFileURL(require.resolve('typebox/value')).href), load('${schema}')]);
const sender = { channelId: 'wecom', accountId: 'test', senderId: 'alice' };
assert.equal(subject(sender), JSON.stringify(['wecom', 'test', 'alice']));
await loading;
assert.throws(() => subject({ ...sender, ignored: true }), /invalid channel identity/);
sender.senderId = '';
assert.throws(() => subject(sender), /invalid channel identity/);
`, enabled ? [] : ['--no-experimental-require-module']);
  }, 100_000);

  it('retains identity links, authorization, revocation and rollback through the SQLite worker', async () => {
    await runIsolated(`
const { i: open } = await load('openclaw-state-db-BF5xXouY.mjs');
const { s: close } = await load('openclaw-state-db-cache-SfxRpkii.mjs');
const { D: ensureProfiles, i: insertProfile } = await load('user-profiles-internal-CrPFdeEA.mjs');
const { l: publish, n: change, t: authorize } = await load('user-channel-identity-operations-CQ0oFkTe.mjs');
const { u: policyFor } = await load('user-channel-identities-CPNsazJx.mjs');
const options = { env: process.env };
const store = open(options);
try {
  ensureProfiles(options, store);
  const alice = insertProfile(store.db, 'Alice', Date.now()).id;
  const bob = insertProfile(store.db, 'Bob', Date.now()).id;
  const identity = { channelId: 'wecom', accountId: 'test', senderId: 'alice' };
  const gateway = { roles: { operations: { scopes: ['operator.read'] } } };
  const owners = ['wecom:test:alice', 'dingtalk:test:bob'];
  const row = store.db.prepare("SELECT value_json FROM config_machine_state WHERE state_key='operator.channelPolicy'");
  const storedPolicy = () => JSON.parse(row.get().value_json);

  await Promise.all([publish(gateway, owners), load('user-profiles.worker-D_T6hArA.mjs')]);
  const firstPolicy = storedPolicy();
  assert.equal(typeof firstPolicy.configuredOwnerPolicy.id, 'string');
  await publish(gateway, [...owners].reverse());
  assert.deepEqual(storedPolicy(), firstPolicy);

  const linked = await change('link', alice, identity, options);
  assert.equal(linked.link.profileId, alice);
  await assert.rejects(change('link', bob, identity, options), { name: 'UserChannelIdentityConflictError' });
  const request = { action: 'authorize', identity, profileId: alice, grant: null, policy: policyFor(gateway) };
  const reference = await authorize(request, options);
  assert.equal(reference?.version, 1);
  assert.deepEqual(await authorize(request, options), reference);

  store.db.exec("CREATE TRIGGER fail_policy BEFORE UPDATE ON config_machine_state WHEN NEW.state_key='operator.channelPolicy' BEGIN SELECT RAISE(ABORT,'fixture-policy-write-failure'); END;");
  await assert.rejects(publish({}, []), /fixture-policy-write-failure/);
  assert.deepEqual(storedPolicy(), firstPolicy);
  assert.deepEqual(await authorize(request, options), reference);
  store.db.exec('DROP TRIGGER fail_policy');
  await publish({}, []);
  assert.equal(storedPolicy().configuredOwnerPolicy, undefined);
  assert.equal(await authorize(request, options), undefined);
  assert.equal((await change('unlink', alice, identity, options)).removed, true);
  assert.equal((await change('unlink', alice, identity, options)).removed, false);
  assert.equal(await authorize({ ...request, policy: policyFor({}) }, options), undefined);
} finally {
  await close();
}
`);
  }, 100_000);
});

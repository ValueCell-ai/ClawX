/** Native migration smoke test. Synthetic state and loopback inference only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, fork } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const repository = resolve(import.meta.dirname, '..');
// Native Windows state ownership rejects broad AppData/Temp ancestors. A new
// private home child gives this synthetic fixture the same supported ACL base.
const option = name => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const reuse = option('--reuse');
const bizRoot = option('--biz-root');
const autoContinuity = process.argv.includes('--auto-continuity');
if (autoContinuity) assert(reuse && bizRoot, '--auto-continuity requires an existing isolated fixture and --biz-root');
const evidencePrefix = autoContinuity ? 'auto-' : '';
const root = reuse ? resolve(reuse) : await mkdtemp(join(homedir(), 'clawx-native-cron-upgrade-'));
if (reuse) assert(root.startsWith(join(homedir(), 'clawx-native-cron-upgrade-')), 'Only this script\'s isolated fixtures may be resumed');
const home = join(root, 'home');
const state = join(home, '.openclaw');
const configPath = join(state, 'openclaw.json');
const entry = join(repository, 'node_modules/openclaw/openclaw.mjs');
for (const dir of [state, join(root, 'tmp'), join(home, 'AppData/Roaming'), join(home, 'AppData/Local')]) await mkdir(dir, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|SystemDrive|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
Object.assign(environment, {
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
  TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
  OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_NO_RESPAWN: '1',
  OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_EXEC_SHELL_SNAPSHOT: '0', CI: '1', NO_COLOR: '1',
});
const requests = [];
const rejectedRequests = [];
const keys = { 'custom-community': 'synthetic-community-key', 'custom-enterpri': 'synthetic-enterprise-key' };
const modelServer = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  if (request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return; }
  const body = JSON.parse(raw);
  const provider = request.headers.authorization === `Bearer ${keys['custom-community']}` ? 'custom-community'
    : request.headers.authorization === `Bearer ${keys['custom-enterpri']}` ? 'custom-enterpri' : null;
  if (!provider) { response.writeHead(401); response.end(); return; }
  if (body.model === 'removed-model') {
    rejectedRequests.push({ provider, model: body.model });
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'model_not_found', message: 'Unknown model: removed-model' } }));
    return;
  }
  requests.push({ provider, model: body.model });
  const content = `cron-native-success-${provider}`;
  if (body.stream) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (delta, finish_reason = null) => ({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
    response.write(`data: ${JSON.stringify(event({ role: 'assistant', content }))}\n\n`);
    response.write(`data: ${JSON.stringify(event({}, 'stop'))}\n\n`);
    response.end('data: [DONE]\n\n');
  } else {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
});
await new Promise(resolveListen => modelServer.listen(0, '127.0.0.1', resolveListen));
const modelPort = modelServer.address().port;
const tcp = createTcpServer();
await new Promise(resolveListen => tcp.listen(0, '127.0.0.1', resolveListen));
const port = tcp.address().port;
await new Promise(resolveClose => tcp.close(resolveClose));
const token = 'synthetic-cron-test-gateway-token';
const cfg = {
  meta: { lastTouchedVersion: '2026.7.1-2', lastTouchedAt: new Date().toISOString() },
  gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token }, controlUi: { enabled: false } },
  agents: { defaults: { workspace: join(home, 'workspace'), model: { primary: 'custom-community/old-model' }, skipBootstrap: true }, list: [
    { id: 'main', default: true }, { id: 'enterprise', workspace: join(home, 'enterprise'), model: { primary: 'custom-enterpri/old-model' } },
  ] },
  update: { checkOnStart: false, auto: { enabled: false } },
  models: { catalogRefresh: { enabled: false }, providers: Object.fromEntries(Object.keys(keys).map(provider => [provider, {
    baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions',
    models: ['old-model', 'new-model', 'removed-model'].map(id => ({ id, name: id, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
  }])) },
  plugins: { enabled: false }, cron: { enabled: true }, tools: { deny: ['*'] },
};
if (!reuse) await writeFile(configPath, JSON.stringify(cfg, null, 2));
for (const [agent, provider] of reuse ? [] : [['main', 'custom-community'], ['enterprise', 'custom-enterpri']]) {
  const directory = join(state, 'agents', agent, 'agent');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: { [`${provider}:default`]: { type: 'api_key', provider, key: keys[provider] } } }));
}
let jobs = [
  { id: 'community-inherited', agentId: 'main' }, { id: 'enterprise-inherited', agentId: 'enterprise' },
  { id: 'community-explicit-removed', agentId: 'main', model: 'custom-community/removed-model' },
].map(({ id, agentId, model }) => ({
  id, agentId, name: id, enabled: false, createdAtMs: Date.now() - 86400000, updatedAtMs: Date.now() - 1000,
  schedule: { kind: 'every', everyMs: 86400000, anchorMs: Date.now() - 86400000 },
  sessionTarget: 'isolated', wakeMode: 'next-heartbeat',
  payload: { kind: 'agentTurn', message: 'Reply with a short hydration reminder.', toolsAllow: [], ...(model ? { model } : {}) },
  delivery: { mode: 'none' }, state: {},
}));

const compiled = join(root, 'prepare.mjs');
await build({ stdin: { contents: `export { ensureOpenClawUpgradeSnapshot } from ${JSON.stringify(join(repository, 'electron/utils/openclaw-upgrade-snapshot.ts'))}; export { prepareCronInferenceMigration } from ${JSON.stringify(join(repository, 'electron/utils/openclaw-cron-migration.ts'))};`, resolveDir: repository, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: compiled, external: ['electron'], banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' }, logLevel: 'silent' });
const prepare = await import(pathToFileURL(compiled).href);
let commandIndex = 0;
async function cli(args, timeout = 120000) {
  return await new Promise((resolveCommand, reject) => {
    const remoteArgs = args[0] === 'cron' ? [...args, '--url', `ws://127.0.0.1:${port}`, '--token', token] : args;
    const child = spawn(process.execPath, [entry, ...remoteArgs], { env: environment, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timed out: ${args.join(' ')}`)); }, timeout);
    child.on('error', reject);
    child.on('exit', async code => {
      clearTimeout(timer);
      await writeFile(join(root, `${evidencePrefix}cli-${commandIndex++}.log`), output);
      if (code !== 0) reject(new Error(`CLI ${args.join(' ')} failed (${code}): ${output.slice(-4000)}`));
      else resolveCommand(output);
    });
  });
}
let gateway;
let enterpriseContinuityVerified = false;
let expectedPreviousEnterpriseBinding;
async function exerciseEnterpriseContinuity(snapshotManifest) {
  if (!bizRoot) { console.log('Native enterprise teardown continuity skipped: pass --biz-root to the separate enterprise repository'); return; }
  const source = resolve(bizRoot, 'extensions/enterprise-auth/cron-continuity.ts');
  assert(existsSync(source), 'The supplied enterprise repository must provide cron-continuity.ts');
  const output = join(root, `${evidencePrefix}enterprise-continuity.json`);
  const script = join(root, `${evidencePrefix}enterprise-continuity.mjs`);
  await build({
    stdin: { contents: `
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import { captureEnterpriseCronContinuity } from ${JSON.stringify(source)};
      import { readAuthProfilesFromSqlite, writeAuthProfilesToSqlite } from ${JSON.stringify(join(repository, 'electron/utils/openclaw-auth-sqlite.ts'))};
      const cfg = JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
      const entries = await captureEnterpriseCronContinuity(cfg, ${JSON.stringify(keys['custom-enterpri'])});
      assert.equal(entries.length, 1, 'native capture must retain the populated enterprise task');
      assert.equal(entries[0].jobId, 'enterprise-inherited');
      const store = readAuthProfilesFromSqlite('enterprise');
      assert(store?.profiles['custom-enterpri:default']);
      const profile = store.profiles['custom-enterpri:default'];
      delete store.profiles['custom-enterpri:default'];
      writeAuthProfilesToSqlite(store, 'enterprise');
      store.profiles['custom-enterpri:default'] = profile;
      writeAuthProfilesToSqlite(store, 'enterprise');
      await writeFile(${JSON.stringify(output)}, JSON.stringify({ version: 1, jobs: entries }));
      console.log('Native enterprise capture and profile removal/reprojection completed');
    `, resolveDir: repository, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: script, logLevel: 'silent',
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    plugins: [{ name: 'isolated-host-locations', setup(plugin) {
      plugin.onResolve({ filter: /^(@electron\/utils\/paths|\.\/paths)$/ }, () => ({ path: 'paths', namespace: 'smoke-paths' }));
      plugin.onLoad({ filter: /.*/, namespace: 'smoke-paths' }, () => ({ contents: `export const getOpenClawResolvedDir = () => ${JSON.stringify(join(repository, 'node_modules/openclaw'))}; export const resolveOpenClawStateDir = () => process.env.OPENCLAW_STATE_DIR;` }));
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'smoke-electron' }));
      plugin.onLoad({ filter: /.*/, namespace: 'smoke-electron' }, () => ({ contents: 'export const app = { isPackaged: false, getPath: () => process.env.APPDATA };' }));
    } }],
  });
  await new Promise((resolveProgram, reject) => {
    const child = spawn(process.execPath, [script], { env: environment, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Native enterprise capture timed out')); }, 60000);
    child.on('exit', async code => { clearTimeout(timeout); await writeFile(join(root, `${evidencePrefix}enterprise-continuity.log`), text); code === 0 ? resolveProgram() : reject(new Error(text)); });
    child.on('error', reject);
  });
  const original = JSON.parse(await readFile(snapshotManifest, 'utf8'));
  const captured = JSON.parse(await readFile(output, 'utf8'));
  expectedPreviousEnterpriseBinding = captured.jobs[0].expectedPreviousBinding;
  assert(expectedPreviousEnterpriseBinding?.authorizationId, 'Native receipt must prove the previous authorization');
  original.jobs = [...original.jobs.filter(entry => !captured.jobs.some(current => current.jobId === entry.jobId)), ...captured.jobs];
  const combined = join(root, `${evidencePrefix}launch-continuity.json`);
  await writeFile(combined, JSON.stringify(original));
  environment.CLAWX_CRON_MIGRATION_MANIFEST = combined;
}
async function stop() {
  if (!gateway || gateway.exitCode !== null) return;
  const child = gateway;
  await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Gateway did not stop gracefully')); }, 45000);
    child.once('exit', () => { clearTimeout(timer); resolveExit(); });
    child.send({ shutdown: true });
  });
  gateway = undefined;
}
try {
  console.log(`Isolated evidence: ${root}`);
  if (!reuse) await cli(['doctor', '--fix', '--yes', '--non-interactive'], 240000);
  const missingMainDatabaseAtBootstrap = !existsSync(join(state, 'agents/main/agent/openclaw-agent.sqlite'));
  if (!reuse) assert(missingMainDatabaseAtBootstrap, 'This fixture must cover native authorization enrollment while the main agent database is first created');
  // The native release rejects pre-July JSON stores. Model the supported
  // post-schema-migration boundary with legacy unbound rows in canonical SQLite;
  // actual credential import, account capture, CAS commit and execution stay native.
  const seed = new DatabaseSync(join(state, 'state/openclaw.sqlite'));
  try {
    if (reuse) jobs = jobs.map(old => JSON.parse(seed.prepare('SELECT job_json FROM cron_jobs WHERE job_id=?').get(old.id).job_json));
    else {
      const insert = seed.prepare('INSERT INTO cron_jobs (store_key, job_id, owner_agent_id, name, enabled, agent_id, payload_kind, job_json, state_json, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      seed.exec('BEGIN IMMEDIATE');
      for (const [index, old] of jobs.entries()) insert.run(join(state, 'cron/jobs.json'), old.id, old.agentId, old.name, 0, old.agentId, 'agentTurn', JSON.stringify(old), '{}', index, old.updatedAtMs);
      seed.exec('COMMIT');
    }
    if (autoContinuity) {
      // Synthetic metadata-only seed: credentials and native authorization ID
      // remain unchanged; the real acquire/capture/renewal paths run below.
      const enterprise = jobs.find(old => old.id === 'enterprise-inherited');
      assert(enterprise.inferenceBinding?.authorizationId);
      enterprise.inferenceBinding.source = 'auto';
      seed.prepare('UPDATE cron_jobs SET job_json=? WHERE job_id=?').run(JSON.stringify(enterprise), enterprise.id);
    }
  } finally { seed.close(); }
  if (!reuse) {
    const agentDb = new DatabaseSync(join(state, 'agents/enterprise/agent/openclaw-agent.sqlite'));
    try {
      // A previously executed water reminder contains this automatic account
      // pin. It is not a user model override and must survive source capture.
      const sessionId = randomUUID();
      const entry = { sessionId, updatedAt: Date.now(), model: 'old-model', modelProvider: 'custom-enterpri', authProfileOverride: 'custom-enterpri:default', authProfileOverrideSource: 'auto', authProfileOverrideCompactionCount: 0 };
      agentDb.prepare('INSERT INTO session_nodes (session_key, current_session_id, entry_json, entry_valid, updated_at) VALUES (?, ?, ?, 1, ?)')
        .run('agent:enterprise:cron:enterprise-inherited', sessionId, JSON.stringify(entry), entry.updatedAt);
    } finally { agentDb.close(); }
  }
  const snapshot = await prepare.ensureOpenClawUpgradeSnapshot({ stateDir: state, configPath });
  const manifest = await prepare.prepareCronInferenceMigration(snapshot.snapshotDir);
  assert.equal(manifest.eligible, jobs.length);
  environment.CLAWX_CRON_MIGRATION_MANIFEST = manifest.manifestPath;
  const migratedConfig = JSON.parse(await readFile(configPath, 'utf8'));
  migratedConfig.gateway.port = port;
  migratedConfig.models.catalogRefresh = { enabled: false };
  migratedConfig.update = { checkOnStart: false, auto: { enabled: false } };
  migratedConfig.agents.defaults.model.primary = 'custom-community/new-model';
  const enterprise = migratedConfig.agents.entries?.enterprise ?? migratedConfig.agents.list?.find(agent => agent.id === 'enterprise');
  enterprise.model = { primary: 'custom-enterpri/new-model' };
  for (const provider of Object.values(migratedConfig.models.providers)) {
    provider.models = provider.models.filter(model => model.id !== 'removed-model');
    provider.baseUrl = `http://127.0.0.1:${modelPort}/v1`;
  }
  await writeFile(configPath, JSON.stringify(migratedConfig, null, 2));
  const wrapper = join(root, 'gateway.mjs');
  await writeFile(wrapper, `process.on('message', message => { if (message.shutdown) { process.emit('SIGTERM'); process.disconnect(); } }); process.argv = [process.execPath, ${JSON.stringify(entry)}, 'gateway', '--port', '${port}', '--token', '${token}', '--allow-unconfigured']; await import(${JSON.stringify(pathToFileURL(entry).href)});`);
  if (autoContinuity) {
    await exerciseEnterpriseContinuity(manifest.manifestPath);
    jobs = jobs.filter(old => old.id === 'enterprise-inherited');
    assert.equal(expectedPreviousEnterpriseBinding.source, 'auto');
  }
  const cycles = autoContinuity ? 1 : 2;
  for (let cycle = 0; cycle < cycles; cycle++) {
    const log = createWriteStream(join(root, `${evidencePrefix}gateway-${cycle}.log`));
    gateway = fork(wrapper, [], { env: environment, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    gateway.stdout.pipe(log, { end: false }); gateway.stderr.pipe(log, { end: false });
    const deadline = Date.now() + 180000;
    for (;;) {
      if (gateway.exitCode !== null) throw new Error('Gateway exited before readiness');
      try { if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) break; } catch { /* not listening yet */ }
      if (Date.now() >= deadline) throw new Error('Gateway readiness timed out');
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    // Gateway HTTP readiness precedes asynchronous scheduler startup; the
    // beforeStart migration must finish before dispatch, not before /readyz.
    const bindingDeadline = Date.now() + 120000;
    for (;;) {
      const probe = new DatabaseSync(join(state, 'state/openclaw.sqlite'), { readOnly: true });
      let ready;
      try { ready = jobs.every(old => {
        const binding = JSON.parse(probe.prepare('SELECT job_json FROM cron_jobs WHERE job_id = ?').get(old.id).job_json).inferenceBinding;
        if (!binding) return false;
        return old.id !== 'enterprise-inherited' || !expectedPreviousEnterpriseBinding
          || binding.authorizationId !== expectedPreviousEnterpriseBinding.authorizationId;
      }); }
      finally { probe.close(); }
      if (ready) break;
      if (Date.now() >= bindingDeadline) throw new Error('Native cron binding migration timed out; inspect gateway log');
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    const db = new DatabaseSync(join(state, 'state/openclaw.sqlite'), { readOnly: true });
    try {
      for (const old of jobs) {
        const row = db.prepare('SELECT job_json FROM cron_jobs WHERE job_id = ?').get(old.id);
        const current = JSON.parse(row.job_json);
        assert.equal(current.inferenceBinding?.profileId, `${old.agentId === 'enterprise' ? 'custom-enterpri' : 'custom-community'}:default`);
        assert.equal(current.enabled, false);
        assert.deepEqual(current.payload, old.payload);
        if (old.id === 'enterprise-inherited' && expectedPreviousEnterpriseBinding) {
          assert.notEqual(current.inferenceBinding.authorizationId, expectedPreviousEnterpriseBinding.authorizationId);
          const { authorizationId: _old, ...previous } = expectedPreviousEnterpriseBinding;
          const { authorizationId: _new, ...renewed } = current.inferenceBinding;
          assert.deepEqual(renewed, previous, 'Continuity may renew the authorization but must retain the exact account and source');
          enterpriseContinuityVerified = true;
        }
      }
    } finally { db.close(); }
    for (const old of jobs) {
      const enqueuedRaw = await cli(['cron', 'run', old.id, '--expect-final', '--timeout', '120000']);
      const enqueued = JSON.parse(enqueuedRaw.slice(enqueuedRaw.indexOf('{')));
      const runDeadline = Date.now() + 120000;
      let finished;
      while (!finished) {
        const raw = await cli(['cron', 'runs', '--id', old.id, '--limit', '10']);
        const result = JSON.parse(raw.slice(raw.indexOf('{')));
        finished = result.entries.find(entry => entry.runId === enqueued.runId);
        if (!finished) {
          if (Date.now() >= runDeadline) throw new Error(`Cron completion timed out: ${old.id}`);
          await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
        }
      }
      assert.equal(finished.status, 'ok', JSON.stringify(finished));
      assert.equal(finished.model, 'new-model');
      console.log(`Completed ${old.id} in cycle ${cycle + 1}`);
    }
    await stop(); log.end();
    console.log(`Native migration cycle ${cycle + 1} passed`);
    if (!autoContinuity && cycle === 0) await exerciseEnterpriseContinuity(manifest.manifestPath);
  }
  assert.equal(requests.length, jobs.length * cycles);
  assert(requests.every(request => request.model === 'new-model'));
  assert.equal(rejectedRequests.length, autoContinuity ? 0 : 2, 'Each explicit removed-model run must exercise the real fallback');
  if (bizRoot) assert(enterpriseContinuityVerified, 'The populated enterprise receipt must actually renew the native binding');
  await writeFile(join(root, `${evidencePrefix}result.json`), JSON.stringify({ passed: true, cycles, autoContinuity, missingMainDatabaseAtBootstrap, enterpriseContinuityVerified, jobs: jobs.map(job => job.id), requests, rejectedRequests }, null, 2));
  console.log(autoContinuity
    ? 'PASS: native enterprise automatic-account continuity preserved after authorization renewal and a real loopback inference run.'
    : `PASS: ${requests.length} real loopback inference requests, community and synthetic enterprise profiles, migration and restart; enterprise teardown continuity=${enterpriseContinuityVerified}.`);
} finally {
  await stop().catch(error => { console.error(`Cleanup: ${error.message}`); });
  await new Promise(resolveClose => modelServer.close(resolveClose));
}

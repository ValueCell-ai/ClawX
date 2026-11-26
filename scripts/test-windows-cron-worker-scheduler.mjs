// Run the real scheduler and Windows Job against a loopback model and a local-only worker.
import assert from 'node:assert/strict';
import { execFileSync, fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createServer as createTcpServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'win32', 'Requires Windows');
const repository = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const runtime = createRequire(require.resolve('openclaw'));
assert.ok(runtime('@openclaw/proc-safe/windows-job').isSupported(), 'Requires the native Windows Job binding');
const entry = join(repository, 'node_modules/openclaw/openclaw.mjs');
const uvDir = join(repository, 'resources/bin/win32-' + process.arch);
const uv = existsSync(join(uvDir, 'uv.exe')) ? join(uvDir, 'uv.exe') : 'uv.exe';
const cache = join(repository, '.cache');
await mkdir(cache, { recursive: true });
const root = await mkdtemp(join(cache, 'cron-worker-scheduler-'));
const state = join(root, '.openclaw');
const workspace = join(state, 'workspace');
const fixtureDir = join(workspace, 'counter');
const configPath = join(state, 'openclaw.json');
const launcher = join(fixtureDir, 'start_counter.py');
const receipt = join(fixtureDir, 'count.json');
const launchReceipt = join(fixtureDir, 'launcher.json');
const agentDir = join(state, 'agents/main/agent');
for (const folder of [workspace, fixtureDir, agentDir, join(root, 'tmp'), join(root, 'local'), join(root, 'roaming')]) {
  await mkdir(folder, { recursive: true });
}
console.log('Isolated scheduler fixture:', root);
const python = execFileSync(uv, ['python', 'find', '--offline'], {
  env: { ...process.env, UV_CACHE_DIR: join(root, 'uv-cache') }, encoding: 'utf8', windowsHide: true,
}).trim();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
env[pathKey] = [uvDir, dirname(process.execPath), env[pathKey]].join(delimiter);
Object.assign(env, {
  HOME: root, USERPROFILE: root, APPDATA: join(root, 'roaming'), LOCALAPPDATA: join(root, 'local'),
  TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp'),
  OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_NO_RESPAWN: '1', OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
  UV_CACHE_DIR: join(root, 'uv-cache'), UV_PYTHON: python, UV_NO_PROJECT: '1', UV_OFFLINE: '1',
  UV_PYTHON_DOWNLOADS: 'never', CI: '1', NO_COLOR: '1',
});

// The counter needs thirteen five-second ticks, longer than the launch deadline.
await writeFile(join(fixtureDir, 'counter.py'), `import ctypes, json, os, sys, time
from pathlib import Path

in_job = ctypes.c_int()
if not ctypes.windll.kernel32.IsProcessInJob(ctypes.c_void_p(-1), None, ctypes.byref(in_job)):
    raise ctypes.WinError()
started = time.monotonic()
deadline = started + int(sys.argv[1])
count = 0
while count < 13:
    time.sleep(5)
    if time.monotonic() >= deadline:
        raise TimeoutError("counter timed out")
    count += 1
result = dict(count=count, seconds=time.monotonic() - started, pid=os.getpid(),
              parent=os.getppid(), inJob=bool(in_job.value))
Path(__file__).with_name("count.json").write_text(json.dumps(result))
`);
await writeFile(launcher, `import argparse, json, subprocess, sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--start", action="store_true", required=True)
parser.add_argument("--count-timeout-seconds", type=int, required=True)
options = parser.parse_args()
child = subprocess.Popen([sys.executable, Path(__file__).with_name("counter.py"), str(options.count_timeout_seconds)],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, creationflags=subprocess.DETACHED_PROCESS)
Path(__file__).with_name("launcher.json").write_text(json.dumps(dict(child=child.pid)))
print("Counter queued", flush=True)
`);
const scriptPath = launcher.replaceAll('\\', '/');
const command = `uv run python "${scriptPath}" --start --count-timeout-seconds 90`;
const message = `Run the counter fixture.\n${command}`;
const calls = [];
const model = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') return response.writeHead(404).end();
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  const results = input.messages.filter(item => item.role === 'tool');
  calls.push({ at: Date.now(), results, receiptExists: existsSync(receipt) });
  const delta = results.length ? { content: 'Synthetic worker finished.' } : { tool_calls: [{
    index: 0, id: 'worker_call', type: 'function',
    function: { name: 'exec', arguments: JSON.stringify({ command, workdir: fixtureDir }) },
  }] };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const id = randomUUID();
  for (const [part, reason] of [[{ role: 'assistant' }, null], [delta, null], [{}, results.length ? 'stop' : 'tool_calls']]) {
    response.write('data: ' + JSON.stringify({
      id, object: 'chat.completion.chunk', model: input.model, created: Math.floor(Date.now() / 1000),
      choices: [{ index: 0, delta: part, finish_reason: reason }],
    }) + '\n\n');
  }
  response.end('data: [DONE]\n\n');
});
async function listen(server) {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  return server.address().port;
}

const token = randomUUID();
const modelPort = await listen(model);
const socket = createTcpServer();
const port = await listen(socket);
await new Promise(done => socket.close(done));
const config = {
  gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token }, controlUi: { enabled: false } },
  agents: { defaults: { workspace, skipBootstrap: true, model: { primary: 'fixture/local' } }, entries: { main: {} } },
  update: { checkOnStart: false, auto: { enabled: false } }, plugins: { enabled: false },
  models: { catalogRefresh: { enabled: false }, providers: { fixture: {
    baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: 'openai-completions', apiKey: 'fixture-only',
    models: [{ id: 'local', name: 'local', input: ['text'], contextWindow: 128000, maxTokens: 4096 }],
  } } },
  cron: { enabled: true }, tools: { profile: 'full', exec: { host: 'gateway', mode: 'full' } },
};

let gateway;
async function cli(args) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  const timer = setTimeout(() => child.kill(), 175_000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, `CLI ${args.slice(0, 2).join(' ')} failed: ${(err + out).slice(-2500)}`);
    return out;
  } finally { clearTimeout(timer); }
}
async function cron(args) {
  const out = await cli(['cron', ...args, '--url', 'ws://127.0.0.1:' + port, '--token', token]);
  return JSON.parse(out.slice(out.indexOf('{')));
}
async function startGateway() {
  const log = createWriteStream(join(root, 'gateway.log'), { flags: 'a' });
  gateway = fork(join(repository, 'tests/fixtures/openclaw-061-cron-gateway.mjs'), [entry, String(port), token], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  gateway.stdout.pipe(log, { end: false });
  gateway.stderr.pipe(log, { end: false });
  gateway.once('close', () => log.end());
  const until = Date.now() + 120_000;
  while (Date.now() < until && gateway.exitCode === null) {
    try { if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) return; } catch { /* starting */ }
    await delay(250);
  }
  throw Error('Gateway failed to start; inspect ' + join(root, 'gateway.log'));
}
async function stopGateway() {
  if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null) return;
  const stopped = once(gateway, 'close');
  const timer = setTimeout(() => gateway.kill(), 20_000);
  try {
    if (gateway.connected) gateway.send('stop');
    await stopped;
  } finally { clearTimeout(timer); }
}
try {
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: {
    'fixture:default': { type: 'api_key', provider: 'fixture', key: 'fixture-only' },
  } }));
  await cli(['doctor', '--fix', '--yes', '--non-interactive']);
  await startGateway();
  await cron(['add', '--declaration-key', 'fixture-counter', '--name', 'Counter smoke test',
    '--agent', 'main', '--session', 'isolated', '--every', '6h', '--no-deliver', '--tools', 'exec',
    '--timeout-seconds', '60', '--message', message, '--json']);
  const savedJob = () => {
    const db = new DatabaseSync(join(state, 'state/openclaw.sqlite'), { readOnly: true });
    try {
      const row = db.prepare("SELECT job_json FROM cron_jobs WHERE json_extract(job_json, '$.declarationKey') = ?")
        .get('fixture-counter');
      assert.ok(row, 'Declaration should be persisted');
      const { state: _runState, updatedAtMs: _updatedAt, ...definition } = JSON.parse(row.job_json);
      return definition;
    } finally { db.close(); }
  };
  const before = savedJob();
  assert.equal(before.payload.timeoutSeconds, 60);
  await stopGateway();
  await startGateway();
  console.log('Running saved job %s with timeoutSeconds=%d', before.id, before.payload.timeoutSeconds);
  const run = await cron(['run', before.id, '--expect-final', '--timeout', '145000']);
  const until = Date.now() + 145_000;
  let completion;
  do {
    const history = await cron(['runs', '--id', before.id, '--limit', '5']);
    completion = history.entries.find(row => row.runId === run.runId);
    if (!completion) await delay(500);
  } while (!completion && Date.now() < until);
  assert.equal(completion?.status, 'ok', JSON.stringify(completion));
  assert.deepEqual(savedJob(), before, 'Cron configuration changed');
  const started = JSON.parse(await readFile(launchReceipt, 'utf8'));
  const worker = JSON.parse(await readFile(receipt, 'utf8'));
  assert.equal(worker.inJob, true);
  assert.equal(worker.count, 13);
  assert.ok(worker.seconds >= 60, 'Worker must outlive the configured cron timeout');
  assert.ok([worker.pid, worker.parent].includes(started.child), 'Launcher PID must identify the worker or its interpreter shim');
  assert.equal(calls.filter(call => !call.results.length).length, 1, 'Launcher should run once');
  const response = calls.find(call => call.results.length);
  assert.ok(response?.receiptExists, 'Agent received tool result before worker completion');
  assert.match(JSON.stringify(response.results), /Counter queued/);
  console.log(JSON.stringify({ cronStatus: completion.status, unchangedTimeoutSeconds: before.payload.timeoutSeconds,
    workerSeconds: worker.seconds, launcherChildPid: started.child, workerPid: worker.pid }));
} finally {
  await stopGateway();
  model.closeAllConnections();
  await new Promise(done => model.close(done));
  await writeFile(join(root, 'model-calls.json'), JSON.stringify(calls, null, 2));
}

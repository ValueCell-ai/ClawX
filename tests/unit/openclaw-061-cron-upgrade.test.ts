// @vitest-environment node
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { ensureOpenClawUpgradeSnapshot } from '@electron/utils/openclaw-upgrade-snapshot';
import { prepareCronTimeoutMigration } from '@electron/utils/openclaw-cron-migration';

const entry = resolve('node_modules/openclaw/openclaw.mjs');
const fixture = resolve('tests/fixtures/openclaw-061-cron.sqlite.gz');
const cli = promisify(execFile);

type Job = {
  id: string; name: string; agentId: string; sessionTarget: string; enabled: boolean;
  schedule: unknown; delivery: unknown; payload: { kind: string; message: string; timeoutSeconds: number; toolsAllow: string[] };
};

it('upgrades real 0.6.1 cron storage through doctor and two Gateway starts', async () => {
  // Windows state ownership accepts a private profile child; shared Temp may inherit broader ACLs.
  const home = await mkdtemp(join(process.platform === 'win32' ? homedir() : tmpdir(), 'clawx-061-cron-'));
  const stateDir = join(home, '.openclaw');
  const configPath = join(stateDir, 'openclaw.json');
  const dbPath = join(stateDir, 'state', 'openclaw.sqlite');
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|SystemDrive|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
  Object.assign(env, {
    HOME: home, USERPROFILE: home, OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_NO_RESPAWN: '1', OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_EXEC_SHELL_SNAPSHOT: '0', CI: '1', NO_COLOR: '1',
  });
  try {
    const temp = join(home, 'tmp');
    Object.assign(env, { APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: temp, TMP: temp, TMPDIR: temp });
    await Promise.all([temp, env.APPDATA!, env.LOCALAPPDATA!].map(path => mkdir(path, { recursive: true, mode: 0o700 })));
    const server = createServer();
    await new Promise<void>((accept, reject) => server.once('error', reject).listen(0, '127.0.0.1', accept));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(done => server.close(() => done()));
    const token = 'synthetic-061-cron-test-only';
    await mkdir(join(stateDir, 'state'), { recursive: true, mode: 0o700 });
    await writeFile(configPath, JSON.stringify({
      meta: { lastTouchedVersion: '2026.7.1-2' },
      gateway: { mode: 'local', port, bind: 'loopback', auth: { mode: 'token', token }, controlUi: { enabled: false } },
      agents: { list: [{ id: 'main', default: true }], defaults: { workspace: join(home, 'workspace'), skipBootstrap: true } },
      plugins: { enabled: false }, discovery: { mdns: { mode: 'off' } },
      update: { checkOnStart: false, auto: { enabled: false } }, models: { catalogRefresh: { enabled: false } },
    }), { mode: 0o600 });
    await writeFile(dbPath, gunzipSync(await readFile(fixture)), { mode: 0o600 });
    const old = new DatabaseSync(dbPath);
    let jobs: Job[];
    try {
      // v0.6.1 indexed jobs by the absolute store path of the originating profile.
      old.prepare('UPDATE cron_jobs SET store_key=?').run(join(stateDir, 'cron', 'jobs.json'));
      jobs = old.prepare('SELECT job_json FROM cron_jobs ORDER BY job_id').all().map(row => JSON.parse(String(row.job_json)));
    } finally { old.close(); }

    const snapshot = await ensureOpenClawUpgradeSnapshot({ stateDir, configPath });
    const manifest = await prepareCronTimeoutMigration(snapshot.snapshotDir);
    expect(manifest.eligible).toBe(1);
    expect(manifest.manifestPath).toBeTruthy();
    env.CLAWX_CRON_TIMEOUT_MIGRATION_MANIFEST = manifest.manifestPath;
    await cli(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'], { cwd: home, env, timeout: 240_000 });

    for (let cycle = 0; cycle < 2; cycle++) {
      const gateway = fork(resolve('tests/fixtures/openclaw-061-cron-gateway.mjs'), [entry, String(port), token], {
        cwd: home, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [],
      });
      let output = '';
      const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-6000); };
      gateway.stdout!.on('data', capture);
      gateway.stderr!.on('data', capture);
      const exited = once(gateway, 'exit');
      try {
        const deadline = Date.now() + 180_000;
        for (;;) {
          if (gateway.exitCode !== null || gateway.signalCode || Date.now() >= deadline) throw new Error('Gateway failed to become ready: ' + output);
          try { if ((await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(2_000) })).ok) break; } catch { /* starting */ }
          await delay(250);
        }
        // /readyz precedes asynchronous cron.start(). Wait for its durable mutation before querying the scheduler.
        await expect.poll(() => {
          const db = new DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db.prepare('SELECT job_json FROM cron_jobs WHERE job_id=?').get('legacy-launcher');
            return row && JSON.parse(String(row.job_json)).payload.timeoutSeconds;
          } finally { db.close(); }
        }, { timeout: 120_000, interval: 150 }).toBe(3600);
        const { stdout } = await cli(process.execPath, [entry, 'gateway', 'call', 'cron.list', '--json', '--token', token,
          '--url', `ws://127.0.0.1:${port}`, '--params', '{"includeDisabled":true}'], { cwd: home, env, timeout: 60_000 });
        const listed: Job[] = JSON.parse(stdout).jobs;
        for (const original of jobs) {
          const current = listed.find(job => job.id === original.id);
          expect(current).toMatchObject({
            id: original.id, name: original.name, enabled: original.enabled, agentId: original.agentId,
            sessionTarget: original.sessionTarget, schedule: original.schedule, delivery: original.delivery,
            payload: { ...original.payload, timeoutSeconds: original.id === 'legacy-launcher' ? 3600 : original.payload.timeoutSeconds },
          });
        }
      } finally {
        if (gateway.connected) gateway.send('stop');
        const kill = setTimeout(() => gateway.kill('SIGKILL'), 45_000);
        try { expect(await exited, output).toEqual([0, null]); } finally { clearTimeout(kill); }
      }
    }
  } finally { await rm(home, { recursive: true, force: true }); }
}, 1_100_000);

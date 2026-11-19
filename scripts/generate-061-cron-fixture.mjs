// Rebuild the synthetic database with the installed community v0.6.1 checkout.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const [checkout] = process.argv.slice(2);
assert.ok(checkout, 'Pass the path to a ClawX v0.6.1 checkout with dependencies installed.');
const legacy = createRequire(join(resolve(checkout), 'package.json'));
assert.equal(legacy('./package.json').version, '0.6.1');
assert.equal(legacy('./node_modules/openclaw/package.json').version, '2026.7.1-2');
const home = await mkdtemp(join(tmpdir(), 'clawx-061-cron-seed-'));
const stateDir = join(home, '.openclaw');
Object.assign(process.env, {
  HOME: home, USERPROFILE: home, OPENCLAW_HOME: home,
  OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json'),
});
try {
  const { saveCronStore, loadCronStore } = await import(pathToFileURL(legacy.resolve('openclaw/plugin-sdk/cron-store-runtime')));
  const message = '只执行下列命令启动独立 worker，不等待完成：\nuv run python "C:\\temp\\sample.py" --start --refresh-timeout-seconds 1260 --send-timeout-seconds 900\n命令返回后立即结束。';
  const jobs = [
    { id: 'legacy-launcher', message, timeoutSeconds: 60 },
    { id: 'custom-launcher', message, timeoutSeconds: 600 },
    { id: 'short-task', message: 'Review the daily summary.', timeoutSeconds: 60 },
  ].map(({ id, message, timeoutSeconds }) => ({
    id, name: id, agentId: 'main', enabled: true, createdAtMs: 1_775_000_000_000, updatedAtMs: 1_775_000_000_000,
    schedule: { kind: 'at', at: '2099-01-01T00:00:00.000Z' }, sessionTarget: 'isolated', wakeMode: 'now',
    payload: { kind: 'agentTurn', message, timeoutSeconds, toolsAllow: ['exec'] },
    delivery: { mode: 'none' }, state: {},
  }));
  // 0.6.1 keys rows by absolute store path. Use a fixed synthetic path and relocate it in the test.
  const storePath = resolve('/clawx-synthetic-061/cron/jobs.json');
  await saveCronStore(storePath, { version: 1, jobs });
  assert.deepEqual((await loadCronStore(storePath)).jobs.map(job => job.id), jobs.map(job => job.id));
  const dbPath = join(stateDir, 'state', 'openclaw.sqlite');
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
  const output = new URL('../tests/fixtures/openclaw-061-cron.sqlite.gz', import.meta.url);
  await writeFile(output, gzipSync(await readFile(dbPath), { level: 9 }));
} finally {
  await rm(home, { recursive: true, force: true });
}

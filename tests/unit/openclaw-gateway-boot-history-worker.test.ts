// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { it } from 'vitest';

it('records the boot through the real state worker and retains crash-loop suppression when the append fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clawx-boot-history-'));
  try {
    const script = path.join(root, 'exercise.mjs');
    await writeFile(script, `
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (name) => import(pathToFileURL(path.join(process.argv[2], name)).href);
const { c: begin, t: complete } = await load('gateway-boot-lifecycle-DaWhpNgC.mjs');
const { i: open } = await load('openclaw-state-db-BF5xXouY.mjs');
const { s: close } = await load('openclaw-state-db-cache-SfxRpkii.mjs');
const now = Date.now();
try {
  const first = await begin(process.env, now);
  assert(first.id);
  assert.equal(first.decision.uncleanBoots, 0);
  await complete(first.id, { outcome: 'clean_stop', reason: 'stop (SIGTERM)' }, process.env, now + 1);
  const { db } = open({ env: process.env });
  const ended = db.prepare('SELECT outcome, completed_at_ms, pid FROM gateway_boot_lifecycle WHERE boot_id = ?').get(first.id);
  assert.equal(ended.outcome, 'clean_stop');
  assert.equal(ended.completed_at_ms, now + 1);
  assert.equal(ended.pid, process.pid);

  for (let i = 0; i < 3; i++) {
    const boot = await begin(process.env, now + 2 + i);
    assert(boot.id);
    assert.equal(boot.decision.uncleanBoots, i);
  }
  const last = await begin(process.env, now + 5);
  assert(last.id);
  assert.equal(last.decision.tripped, true);
  assert.equal(last.decision.shouldWriteStabilityBundle, true);
  assert.equal(db.prepare('SELECT startup_reason FROM gateway_boot_lifecycle WHERE boot_id = ?').get(last.id).startup_reason, 'gateway.crash_loop_breaker');

  db.prepare('INSERT INTO gateway_boot_lifecycle (boot_id, pid, started_at_ms) VALUES (?, ?, ?)').run('expired-fixture', process.pid, now - 86_400_100);
  db.exec("CREATE TRIGGER fail_boot_append BEFORE INSERT ON gateway_boot_lifecycle BEGIN SELECT RAISE(ABORT, 'fixture append failed'); END;");
  const failed = await begin(process.env, now + 6);
  assert.equal(failed.id, undefined);
  assert.equal(failed.decision.tripped, true);
  assert.equal(failed.decision.shouldWriteStabilityBundle, false);
  assert(db.prepare('SELECT 1 FROM gateway_boot_lifecycle WHERE boot_id = ?').get('expired-fixture'));
  db.exec('DROP TRIGGER fail_boot_append');
  const recovered = await begin(process.env, now + 400_000);
  assert(recovered.id);
  assert.equal(recovered.decision.recovered, true);
  assert.equal(db.prepare('SELECT startup_reason FROM gateway_boot_lifecycle WHERE boot_id = ?').get(recovered.id).startup_reason, 'gateway.crash_loop_recovered');
  assert.equal(db.prepare('SELECT 1 FROM gateway_boot_lifecycle WHERE boot_id = ?').get('expired-fixture'), undefined);
} finally {
  await close();
}
`);
    const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENCLAW_|CLAWX_)/i.test(key)));
    await promisify(execFile)(process.execPath, [script, dist], {
      env: {
        ...env, HOME: root, USERPROFILE: root, OPENCLAW_HOME: root,
        OPENCLAW_STATE_DIR: path.join(root, '.openclaw'), APPDATA: path.join(root, 'roaming'),
        LOCALAPPDATA: path.join(root, 'local'), TMP: root, TEMP: root,
        XDG_STATE_HOME: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_DATA_HOME: root,
      },
      windowsHide: true,
      timeout: 90_000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 100_000);

// Exercise the pinned Gateway's native Windows Job with a short launcher and
// a synthetic worker. This script runs in a separate Node process in Windows CI.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

assert.equal(process.platform, 'win32', 'This check requires the native Windows Job implementation');
const require = createRequire(import.meta.url);
const runtimeEntry = require.resolve('openclaw');
const dist = dirname(runtimeEntry);
const runtime = createRequire(runtimeEntry);
assert.ok(runtime('@openclaw/proc-safe/windows-job').isSupported(), 'The Windows native Job binding is required');
const supervisors = (await readdir(dist)).filter(file => /^supervisor-[\w-]+\.mjs$/.test(file));
const entrypoints = [];
for (const candidate of supervisors) {
  if ((await readFile(join(dist, candidate), 'utf8')).includes('function getProcessSupervisor()')) entrypoints.push(candidate);
}
assert.equal(entrypoints.length, 1, 'Review the bundled process supervisor after an OpenClaw upgrade');
const { t: getProcessSupervisor } = await import(pathToFileURL(join(dist, entrypoints[0])).href);
const supervisor = getProcessSupervisor();
const root = await mkdtemp(join(tmpdir(), 'clawx-cron-worker-'));
const starter = join(root, 'launcher.cjs');
const worker = join(root, 'worker.cjs');
try {
  await writeFile(starter, `
    const {spawn} = require('node:child_process');
    const task = spawn(process.execPath, process.argv.slice(2), {detached: true, stdio: 'ignore'});
    task.unref();
  `);
  await writeFile(worker, `
    const fs = require('node:fs');
    const name = process.argv[2];
    fs.writeFileSync(name + '.ready', 'ready');
    const guard = setTimeout(() => process.exit(2), 30000);
    const poll = setInterval(() => {
      if (!fs.existsSync(name + '.release')) return;
      fs.writeFileSync(name + '.done', 'done');
      clearTimeout(guard);
      clearInterval(poll);
    }, 30);
  `);

  async function launch(name, timeoutMs) {
    const prefix = join(root, name);
    const run = await supervisor.spawn({
      mode: 'child', argv: [process.execPath, starter, worker, prefix],
      cwd: root, timeoutMs, waitForWindowsCronDescendants: true,
    });
    const outcome = run.wait();
    const until = performance.now() + 12_000;
    for (;;) {
      try {
        await readFile(prefix + '.ready');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' || performance.now() > until) throw error;
      }
      await Promise.race([delay(25), outcome.then(() => { throw new Error(name + ' ended before worker startup'); })]);
    }
    // The launcher exits without waiting for the worker. Its result must
    // still be pending until the worker is released, cancelled or times out.
    assert.equal(await Promise.race([outcome.then(() => 'settled'), delay(180, 'pending')]), 'pending');
    return { prefix, run, outcome };
  }

  const success = await launch('finish', 20_000);
  await writeFile(success.prefix + '.release', '');
  assert.equal((await success.outcome).reason, 'exit');
  assert.equal((await success.run.waitForExtinction()).status, 'confirmed');
  assert.equal(await readFile(success.prefix + '.done', 'utf8'), 'done');

  const deadline = await launch('timeout', 6_000);
  assert.equal((await deadline.outcome).reason, 'overall-timeout');
  assert.equal((await deadline.run.waitForExtinction()).status, 'confirmed');

  const cancel = await launch('cancel', 20_000);
  cancel.run.cancel();
  assert.equal((await cancel.outcome).reason, 'manual-cancel');
  assert.equal((await cancel.run.waitForExtinction()).status, 'confirmed');

  const shutdown = await launch('shutdown', 20_000);
  await supervisor.shutdown();
  assert.equal((await shutdown.outcome).reason, 'manual-cancel');
  assert.equal((await shutdown.run.waitForExtinction()).status, 'confirmed');
  console.log('Windows scheduled worker completion, deadline, cancellation and shutdown passed.');
} finally {
  try {
    await supervisor.shutdown();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

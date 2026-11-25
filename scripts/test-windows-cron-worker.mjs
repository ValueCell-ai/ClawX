// Exercise the pinned Gateway's native Windows Job with a short launcher and
// a synthetic worker. This script runs in a separate Node process in Windows CI.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const root = await mkdtemp(join(tmpdir(), 'clawx-cron-worker-'));
process.env.OPENCLAW_HOME = root;
process.env.OPENCLAW_STATE_DIR = join(root, '.openclaw');
process.env.OPENCLAW_CONFIG_PATH = join(root, '.openclaw', 'openclaw.json');
const bundle = name => import(pathToFileURL(join(dist, name)).href);
const { t: getProcessSupervisor } = await bundle(entrypoints[0]);
const { closeOpenClawStateDatabaseAsync } = await bundle('openclaw-state-db-cache-BEkpq4DL.mjs');
const supervisor = getProcessSupervisor();
const starter = join(root, 'launcher.cjs');
const worker = join(root, 'worker.cjs');
try {
  await writeFile(starter, `
    const {spawn} = require('node:child_process');
    const fs = require('node:fs');
    fs.writeFileSync(process.argv[3] + '.launcher-pid', String(process.pid));
    const task = spawn(process.execPath, process.argv.slice(2), {detached: true, stdio: 'ignore'});
    task.unref();
    console.log('GENERATION_STARTED: pid=' + task.pid);
  `);
  await writeFile(worker, `
    const fs = require('node:fs');
    const name = process.argv[2];
    fs.writeFileSync(name + '.ready', String(process.pid));
    const guard = setTimeout(() => process.exit(2), 30000);
    const poll = setInterval(() => {
      if (!fs.existsSync(name + '.release')) return;
      const recipientArg = process.argv.indexOf('--mock-recipient');
      if (recipientArg !== -1) {
        fs.writeFileSync(name + '.receipt.json', JSON.stringify({ recipient: process.argv[recipientArg + 1], workerPid: process.pid }));
      }
      fs.writeFileSync(name + '.done', 'done');
      clearTimeout(guard);
      clearInterval(poll);
    }, 30);
  `);

  async function readPidMarker(file) {
    try {
      const pid = Number(await readFile(file, 'utf8'));
      return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function processExited(pid) {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
  }

  async function waitForWorker(prefix, outcome) {
    const until = performance.now() + 12_000;
    for (;;) {
      const [launcherPid, workerPid] = await Promise.all([
        readPidMarker(prefix + '.launcher-pid'), readPidMarker(prefix + '.ready'),
      ]);
      if (launcherPid && workerPid && processExited(launcherPid)) break;
      assert.ok(performance.now() < until, 'Launcher should exit before the detached worker is released');
      await Promise.race([delay(25), outcome.then(result => {
        throw new Error(prefix + ' ended before worker startup: ' + JSON.stringify(result));
      })]);
    }
    // The launcher exits without waiting for the worker. Its result must
    // still be pending until the worker is released, cancelled or times out.
    const pending = Symbol('pending');
    const earlyResult = await Promise.race([outcome, delay(180, pending)]);
    assert.ok(earlyResult === pending, 'Launcher finished before worker release: ' + JSON.stringify(earlyResult));
  }

  async function launch(name, timeoutMs) {
    const prefix = join(root, name);
    const run = await supervisor.spawn({
      mode: 'child', argv: [process.execPath, starter, worker, prefix],
      cwd: root, timeoutMs, waitForWindowsCronDescendants: true,
    });
    const outcome = run.wait();
    await waitForWorker(prefix, outcome);
    return { prefix, run, outcome };
  }

  const success = await launch('finish', 20_000);
  await writeFile(success.prefix + '.release', '');
  assert.equal((await success.outcome).reason, 'exit');
  assert.equal((await success.run.waitForExtinction()).status, 'confirmed');
  assert.equal(await readFile(success.prefix + '.done', 'utf8'), 'done');

  // A custom budget already matches the snapshot. Register its original launcher
  // without writing a new revision, then run it through the actual exec runtime.
  const { migrateClawxCronTimeouts, getClawxMigratedLauncher } = await bundle('clawx-cron-timeout-migration.mjs');
  const { runClawxCronJob, getClawxCronLauncher } = await bundle('clawx-cron-run-context.mjs');
  const { p: runExec } = await bundle('bash-tools.exec-runtime-DV-8QM6d.mjs');
  const { r: createExecTool } = await bundle('bash-tools-B7jTXO_k.mjs');
  // A new scheduled task can invoke a skill in another directory without
  // carrying a migrated launcher command in the job definition.
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const freshPrefix = join(root, 'fresh');
  const freshJob = {
    id: 'fresh-launcher', sessionTarget: 'isolated',
    payload: { kind: 'agentTurn', message: 'Run the worker skill.', timeoutSeconds: 60 },
  };
  assert.equal(getClawxMigratedLauncher(freshJob), undefined);
  const freshController = new AbortController();
  try {
    await runClawxCronJob({
      job: freshJob, abortSignal: freshController.signal, executionIdentity: { onPostAdmission() {} },
    }, async scheduled => {
      const operationalRunInstance = Object.freeze({ runId: 'fresh', instanceId: 'fresh-instance' });
      await scheduled.executionIdentity.onPostAdmission({ operationalRunInstance });
      const exec = createExecTool({
        operationalRunInstance, cwd: workspace, config: {}, host: 'gateway', mode: 'full',
        security: 'full', ask: 'off', notifyOnExit: false, processToolAvailabilityRef: { value: true },
      });
      const result = exec.execute('fresh-call', {
        command: 'node ./launcher.cjs ./worker.cjs fresh --start', workdir: root, awaitResults: true,
      });
      await waitForWorker(freshPrefix, result);
      await writeFile(freshPrefix + '.release', '');
      const completed = await result;
      assert.equal(completed.details.status, 'completed');
      assert.match(completed.content[0].text, /GENERATION_STARTED: pid=\d+/);
      assert.equal(await readFile(freshPrefix + '.done', 'utf8'), 'done');
    });
  } finally {
    freshController.abort();
  }
  const prefix = join(root, 'custom');
  const command = `node "${starter}" "${worker}" "${prefix}" --start --mock-recipient mock:cron-test`;
  const definition = {
    id: 'custom-launcher', name: 'Custom launcher', agentId: 'main', enabled: true,
    createdAtMs: 1, updatedAtMs: 1, schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated', wakeMode: 'now', delivery: { mode: 'none' }, state: {},
    payload: { kind: 'agentTurn', message: 'Start a background worker:\n' + command, timeoutSeconds: 600 },
  };
  const manifest = join(root, 'custom-manifest.json');
  await writeFile(manifest, JSON.stringify({ version: 1, jobs: [
    { jobId: definition.id, definition, command, timeoutSeconds: 600, agentId: 'main' },
  ] }));
  await migrateClawxCronTimeouts({
    cron: { readJob: async () => structuredClone(definition), updateWithPrecondition: () => assert.fail('Custom timeout changed') },
    env: { CLAWX_CRON_TIMEOUT_MIGRATION_MANIFEST: manifest },
  });
  const launcher = getClawxMigratedLauncher(definition);
  assert.equal(launcher?.timeoutSeconds, 600);
  const controller = new AbortController();
  await runClawxCronJob({ abortSignal: controller.signal, executionIdentity: { onPostAdmission() {} } }, async (scheduled) => {
    const tool = { operationalRunInstance: {} };
    await scheduled.executionIdentity.onPostAdmission(tool);
    const run = await runExec({
      command, workdir: root, env: process.env, warnings: [], maxOutput: 10_000, pendingMaxOutput: 10_000, cleanupMs: 1_000,
      clawxCronLauncher: getClawxCronLauncher(tool, { command }, 1800),
    });
    try {
      await waitForWorker(prefix, run.promise);
      await writeFile(prefix + '.release', '');
      assert.equal((await run.promise).status, 'completed');
      assert.deepEqual(JSON.parse(await readFile(prefix + '.receipt.json', 'utf8')), {
        recipient: 'mock:cron-test', workerPid: Number(await readFile(prefix + '.ready', 'utf8')),
      });
    } finally { controller.abort(); }
  }, launcher);

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
} finally {
  try {
    await supervisor.shutdown();
  } finally {
    // The real exec tool reads the approval store. Release its SQLite handles
    // before removing the isolated state directory on Windows.
    await closeOpenClawStateDatabaseAsync();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
console.log('Windows scheduled worker completion, deadline, cancellation and shutdown passed.');

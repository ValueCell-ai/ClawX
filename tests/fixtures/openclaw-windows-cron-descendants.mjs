import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

assert.equal(process.env.OPENCLAW_STATE_DIR, join(process.env.OPENCLAW_HOME, '.openclaw'));
assert.equal(realpathSync(process.env.OPENCLAW_HOME), realpathSync(process.cwd()));

// Exercise the installed exec runtime and supervisor on every OS. Only the native
// process adapter is substituted, so launcher exit and Job extinction can be delivered
// independently, without wall-clock races or a Windows dependency.
const dist = new URL('../../node_modules/openclaw/dist/', import.meta.url);
const supervisorBundle = 'supervisor-D58YpK8r.mjs';
const childBundle = 'child-DRU8rxky.mjs';
const schedulerBundle = 'service-pOwE_Xvo.mjs';
let job;
const adapterModule = 'export const t = (params) => globalThis.createCronTestAdapter(params); export const o = (env) => env;';
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/' + supervisorBundle) && specifier === './' + childBundle) {
      return { url: 'data:text/javascript,' + encodeURIComponent(adapterModule), shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const module = next(url, context);
    if (url.endsWith('/' + schedulerBundle)) {
      // Expose the installed scheduler's private clock to exercise edge cases with a deterministic clock.
      return { ...module, source: Buffer.from(module.source).toString() + '\nexport { createCronAgentWatchdog };' };
    }
    if (process.platform === 'win32' || !url.endsWith('/bash-tools-B7jTXO_k.mjs')) return module;
    // Emulate Windows for this one admission check, keeping host OS and exec policy intact.
    const gate = /process\.platform === "win32" && (!secretEgressEnabled\s*\? getClawxCronLauncher)/;
    const source = Buffer.from(module.source).toString();
    assert.match(source, gate);
    return { ...module, source: source.replace(gate, '$1') };
  },
});
globalThis.createCronTestAdapter = async ({ onSpawnCleanup }) => {
  const { launcher, extinction, nativeJob, kills, hasDescendants } = job;
  job.started?.resolve();
  const certificate = { status: nativeJob ? 'confirmed' : 'uncertain' };
  onSpawnCleanup(extinction.promise);
  return {
    ready: Promise.resolve(),
    adapter: {
      onStdout() {}, onStderr() {}, dispose() {},
      wait: () => launcher.promise,
      waitForExtinction: () => extinction.promise,
      windowsJobExtinction: nativeJob ? extinction.promise : undefined,
      hasWindowsJobDescendants: () => nativeJob && hasDescendants !== false,
      kill(signal) {
        kills.push(signal);
        launcher.resolve({ code: null, signal });
        extinction.resolve(certificate);
      },
    },
  };
};
const { p: runExec } = await import(new URL('bash-tools.exec-runtime-DV-8QM6d.mjs', dist));
const { t: getSupervisor } = await import(new URL(supervisorBundle, dist));
const { f: withCaller } = await import(new URL('gateway-caller-context-4PMKhr4G.mjs', dist));
const { r: createExecTool } = await import(new URL('bash-tools-B7jTXO_k.mjs', dist));
const { runClawxCronJob } = await import(new URL('clawx-cron-run-context.mjs', dist));
const { createCronAgentWatchdog } = await import(new URL(schedulerBundle, dist));

async function start(options = {}, nativeJob = true, { beginWorkerWait, hasDescendants = true } = {}) {
  job = { nativeJob, hasDescendants, launcher: Promise.withResolvers(), extinction: Promise.withResolvers(), kills: [] };
  const scheduler = new AbortController();
  const run = await runExec({
    command: 'test-launcher', workdir: process.cwd(), env: process.env, warnings: [],
    cleanupMs: 1_000, maxOutput: 10_000, pendingMaxOutput: 10_000, timeoutSec: 20,
    clawxCronLauncher: { command: 'test-launcher', signal: scheduler.signal, timeoutSeconds: options.timeoutSec ?? 20, beginWorkerWait }, ...options,
  });
  return { ...job, scheduler, run };
}
async function exitLauncher(job, code = 0) {
  job.launcher.resolve({ code, signal: null });
  await nextTurn();
}

test('successful scheduled launcher waits for the native Job to empty', async () => {
  const job = await start();
  await exitLauncher(job);
  assert.equal(job.run.session.processActivity.resultSettled, false);
  assert.deepEqual(job.kills, []);
  job.extinction.resolve({ status: 'confirmed' });
  assert.equal((await job.run.promise).status, 'completed');
  assert.deepEqual(job.kills, []);
});

test('the scheduler lends time only while a successful launcher has live native descendants', async () => {
  for (const [code, nativeJob, hasDescendants, shouldLend] of [
    [0, true, true, true], [0, true, false, false], [7, true, true, false], [0, false, true, false],
  ]) {
    const events = [];
    const job = await start({}, nativeJob, {
      hasDescendants,
      beginWorkerWait: () => {
        events.push('started');
        return () => events.push('finished');
      },
    });
    assert.deepEqual(events, []);
    await exitLauncher(job, code);
    assert.deepEqual(events, shouldLend ? ['started'] : []);
    job.extinction.resolve({ status: nativeJob ? 'confirmed' : 'uncertain' });
    await job.run.promise;
    assert.deepEqual(events, shouldLend ? ['started', 'finished'] : []);
  }
});

test('a launcher still running at its deadline gets no worker budget', async () => {
  const starts = [];
  const job = await start({ timeoutSec: 0.1 }, true, {
    beginWorkerWait: () => { starts.push('unexpected'); },
  });
  const result = await job.run.promise;
  assert.equal(result.timedOut, true);
  assert.ok(job.kills.length);
  assert.deepEqual(starts, []);
});

test('the worker clock can be granted once and returns the unused part of the initial minute', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const advance = ms => { now += ms; t.mock.timers.tick(ms); };
  const expired = t.mock.fn();
  const clock = createCronAgentWatchdog({ deferUntilRunner: true, jobTimeoutMs: 60_000, triggerTimeout: expired });
  clock.start();
  assert.equal(clock.beginWorkerWait(240_000), undefined);
  clock.noteRunnerStarted({ phase: 'tool_execution_started' });
  advance(15_000);
  const release = clock.beginWorkerWait(240_000);
  assert.equal(typeof release, 'function');
  advance(75_000);
  assert.equal(expired.mock.callCount(), 0);
  assert.equal(clock.beginWorkerWait(240_000), undefined);
  release();
  advance(30_000);
  release();
  assert.equal(clock.beginWorkerWait(240_000), undefined);
  advance(14_999);
  assert.equal(expired.mock.callCount(), 0);
  advance(1);
  assert.equal(expired.mock.callCount(), 1);
  clock.dispose();
});

test('a delayed event loop cannot revive an expired launcher or worker clock', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const afterHandoff of [false, true]) {
    const expired = t.mock.fn();
    const clock = createCronAgentWatchdog({ deferUntilRunner: true, jobTimeoutMs: 60_000, triggerTimeout: expired });
    clock.start();
    clock.noteRunnerStarted({ phase: 'tool_execution_started' });
    if (afterHandoff) {
      const release = clock.beginWorkerWait(240_000);
      now += 240_000;
      release();
    } else {
      now += 60_000;
      assert.equal(clock.beginWorkerWait(240_000), undefined);
    }
    assert.equal(expired.mock.callCount(), 1);
    assert.equal(clock.beginWorkerWait(240_000), undefined);
    clock.dispose();
  }
});

test('original exec deadline also bounds descendants after launcher success', async () => {
  const job = await start({ timeoutSec: 0.1 });
  await exitLauncher(job);
  const result = await job.run.promise;
  assert.equal(result.exitReason, 'overall-timeout');
  assert.equal(result.timedOut, true);
  assert.ok(job.kills.length);
});

test('scheduler, request owner and explicit process cancellation terminate the Job', async () => {
  for (const source of ['scheduler', 'request', 'kill']) {
    const owner = new AbortController();
    const job = await start({ requestOwners: [{ signal: owner.signal, pendingProcesses: new Set() }] });
    await exitLauncher(job);
    if (source === 'scheduler') job.scheduler.abort();
    if (source === 'request') owner.abort();
    if (source === 'kill') job.run.kill();
    assert.equal((await job.run.promise).exitReason, 'manual-cancel', source);
    assert.ok(job.kills.length, source);
  }
});

test('operator revocation remains active after the launcher exits', async () => {
  const operator = new AbortController();
  const operatorAuthority = { signal: operator.signal, assertCurrent: () => operator.signal.throwIfAborted() };
  const job = await withCaller({ agentId: 'main', sessionKey: 'cron-test', operatorAuthority }, () => start());
  await exitLauncher(job);
  operator.abort();
  assert.equal((await job.run.promise).exitReason, 'manual-cancel');
  assert.ok(job.kills.length);
});

test('ordinary exec, drifted approvals and failed launchers retain normal cleanup', async () => {
  for (const [options, code] of [[{ clawxCronLauncher: undefined }, 0], [{ execCommand: 'different-approved-command' }, 0], [{}, 7]]) {
    const job = await start(options);
    await exitLauncher(job, code);
    assert.equal((await job.run.promise).exitCode, code);
    assert.ok(job.kills.length);
  }
});

test('uncertainty and native Job fallback never report successful completion', async () => {
  const fallback = await start({}, false);
  await exitLauncher(fallback);
  assert.match((await fallback.run.promise).reason, /descendant cleanup could not be confirmed/);
  assert.ok(fallback.kills.length);

  const native = await start();
  await exitLauncher(native);
  native.extinction.resolve({ status: 'uncertain', reason: 'job-observation-failed' });
  assert.match((await native.run.promise).reason, /descendant cleanup could not be confirmed/);
});

test('explicit zero keeps ownership under the outer scheduler limit', async () => {
  const job = await start({ timeoutSec: 0 });
  await exitLauncher(job);
  assert.deepEqual(job.kills, []);
  job.scheduler.abort();
  assert.equal((await job.run.promise).exitReason, 'manual-cancel');
});

test('a verified launcher waits in the real exec tool with and without the process tool', async (t) => {
  const spawn = t.mock.method(getSupervisor(), 'spawn');
  for (const [processAvailable, args, configured, expected] of [
    [false, {}, undefined, 3600],
    [true, {}, undefined, 3600],
    [true, { yieldMs: 10 }, 100, 100],
    [true, { yieldMs: 10, timeoutSeconds: 50 }, 100, 50],
  ]) {
    const scheduler = new AbortController();
    const request = { abortSignal: scheduler.signal, executionIdentity: { onPostAdmission() {} } };
    const command = 'echo launch';
    await runClawxCronJob(request, async (scheduled) => {
      const operationalRunInstance = Object.freeze({ runId: 'run', instanceId: 'instance' });
      await scheduled.executionIdentity.onPostAdmission({ operationalRunInstance });
      const exec = createExecTool({
        operationalRunInstance, cwd: process.cwd(), config: {}, host: 'gateway', mode: 'full',
        security: 'full', ask: 'off', notifyOnExit: false, backgroundMs: 10, timeoutSec: configured,
        processToolAvailabilityRef: { value: processAvailable },
      });
      job = { nativeJob: true, started: Promise.withResolvers(), launcher: Promise.withResolvers(), extinction: Promise.withResolvers(), kills: [] };
      const result = exec.execute('launch', { command, workdir: process.cwd(), ...args });
      await Promise.race([job.started.promise, result.then(() => assert.fail('exec completed before spawn'))]);
      assert.equal(spawn.mock.calls.at(-1).arguments[0].timeoutMs, expected * 1000);
      await exitLauncher(job);
      const outcome = await Promise.race([result, delay(50).then(() => 'still waiting')]);
      assert.equal(outcome, 'still waiting');
      assert.deepEqual(job.kills, []);
      job.extinction.resolve({ status: 'confirmed' });
      assert.equal((await result).details.status, 'completed');
    }, { command, timeoutSeconds: 3600 });
  }
});

test('only an explicitly awaited exec from an isolated agent job waits for workers in its custom workdir', async (t) => {
  const spawn = t.mock.method(getSupervisor(), 'spawn');
  const workdir = join(process.cwd(), 'skill scripts');
  await mkdir(workdir);
  for (const [sessionTarget, awaitResults, shouldWait] of [
    ['isolated', true, true],
    ['isolated', false, false],
    ['current', true, false],
  ]) {
    const request = {
      job: { sessionTarget, payload: { kind: 'agentTurn' } },
      abortSignal: new AbortController().signal, executionIdentity: { onPostAdmission() {} },
    };
    await runClawxCronJob(request, async (scheduled) => {
      const operationalRunInstance = Object.freeze({ runId: 'run', instanceId: 'instance' });
      await scheduled.executionIdentity.onPostAdmission({ operationalRunInstance });
      const exec = createExecTool({
        operationalRunInstance, cwd: process.cwd(), config: {}, host: 'gateway', mode: 'full',
        security: 'full', ask: 'off', notifyOnExit: false, timeoutSec: 100,
        processToolAvailabilityRef: { value: false },
      });
      job = { nativeJob: true, started: Promise.withResolvers(), launcher: Promise.withResolvers(), extinction: Promise.withResolvers(), kills: [] };
      const result = exec.execute('launch', { command: 'echo launch', workdir, awaitResults, timeoutSeconds: 50 });
      await Promise.race([job.started.promise, result.then(() => assert.fail('exec completed before spawn'))]);
      const options = spawn.mock.calls.at(-1).arguments[0];
      assert.equal(realpathSync(options.cwd), realpathSync(workdir));
      assert.equal(options.timeoutMs, 50_000);
      assert.equal(options.waitForWindowsCronDescendants, shouldWait);
      await exitLauncher(job);
      if (shouldWait) {
        assert.deepEqual(job.kills, []);
        job.extinction.resolve({ status: 'confirmed' });
      }
      assert.equal((await result).details.status, 'completed');
      assert.equal(job.kills.length > 0, !shouldWait);
    });
  }
});

test('gateway shutdown still owns and cancels the Job', async () => {
  const job = await start();
  await exitLauncher(job);
  await getSupervisor().shutdown();
  assert.equal((await job.run.promise).exitReason, 'manual-cancel');
  assert.ok(job.kills.length);
});

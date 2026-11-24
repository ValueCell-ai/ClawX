// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const helper = 'clawx-windows-gateway-boot-identity.mjs';
const ownerBundles = [
  'gateway-state-owner-record-iGXCdOwF.mjs',
  'state/openclaw-state-read-worker-cpu-Bm2AUN4y.mjs',
  'state/openclaw-state-lease-heartbeat.worker.js',
];
const knownBoot = { platform: 'win32', identity: '2026-11-15T10:20:30.1234567Z' };

function declaration(source: string, name: string) {
  const match = source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  if (!match) throw new Error(`Missing OpenClaw declaration ${name}`);
  return match[0];
}

describe('Windows gateway boot identity', () => {
  it.each(ownerBundles)('reuses a confirmed boot or performs the original OS read in %s', async (file) => {
    const source = await readFile(path.join(dist, file), 'utf8');
    expect(declaration(source, 'createManagedHandoffBootIdentityReader')).not.toContain('Clawx');
    const reader = declaration(source, 'readGatewayLockProcessNamespace');
    const localRead = vi.fn(() => knownBoot);
    const inheritedRead = vi.fn<() => typeof knownBoot | undefined>();
    const parse = vi.fn((value: unknown) => value);
    const localHost = vi.fn(() => 'local-host');
    const createReader = () => runInNewContext(`let processNamespace; (${reader})`, {
      process: { platform: 'win32', env: {} },
      os: { hostname: localHost },
      GatewayProcessNamespaceSchema: { parse },
      readClawxBootIdentityFromMainThread: inheritedRead,
      createManagedHandoffBootIdentityReader: () => localRead,
      createClawxBootIdentityResponder: () => undefined,
    }) as () => unknown;

    inheritedRead.mockReturnValue(knownBoot);
    const inherited = createReader();
    expect(inherited()).toEqual({ host: 'local-host', ...knownBoot });
    expect(inherited()).toEqual({ host: 'local-host', ...knownBoot });
    expect(localRead).toHaveBeenCalledTimes(0);
    expect(inheritedRead).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);

    inheritedRead.mockReturnValue(undefined);
    expect(createReader()()).toEqual({ host: 'local-host', ...knownBoot });
    expect(localRead).toHaveBeenCalledTimes(1);
    expect(localHost).toHaveBeenCalledTimes(2);
    localRead.mockImplementation(() => { throw new Error('OS query unavailable'); });
    const failed = createReader();
    expect(failed()).toBeNull();
    expect(failed()).toBeNull();
    expect(localRead).toHaveBeenCalledTimes(2);
  });

  it('keeps a verified local namespace when responder registration is unavailable', async () => {
    const source = await readFile(path.join(dist, ownerBundles[0]), 'utf8');
    const reader = declaration(source, 'readGatewayLockProcessNamespace');
    const osQuery = vi.fn(() => knownBoot);
    const unavailable = vi.fn(() => { throw new Error('worker messaging unavailable'); });
    const read = runInNewContext(`let processNamespace; (${reader})`, {
      process: { platform: 'win32', env: {}, on: unavailable },
      os: { hostname: () => 'local-host' },
      GatewayProcessNamespaceSchema: { parse: (value: unknown) => value },
      readClawxBootIdentityFromMainThread: () => undefined,
      createManagedHandoffBootIdentityReader: () => osQuery,
      createClawxBootIdentityResponder: () => () => {},
    }) as () => unknown;
    expect(read()).toEqual({ ...knownBoot, host: 'local-host' });
    expect(read()).toEqual({ ...knownBoot, host: 'local-host' });
    expect(osQuery).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('falls back before waiting when the runtime lacks thread-to-thread messaging', async () => {
    const source = await readFile(path.join(dist, helper), 'utf8');
    const workerImport = 'import * as workerThreads from "node:worker_threads";';
    expect(source).toContain(workerImport);
    const workerThreads = { isMainThread: false, getEnvironmentData: () => true };
    const wait = vi.fn();
    const api = runInNewContext(
      `${source.replace(workerImport, '').replaceAll('export function ', 'function ')}\n`
        + '({ readClawxBootIdentityFromMainThread, createClawxBootIdentityResponder })',
      { workerThreads, process: { platform: 'win32', argv: ['', '', 'gateway'], parentPort: {} }, Atomics: { wait } },
    ) as {
      readClawxBootIdentityFromMainThread: () => unknown;
      createClawxBootIdentityResponder: (value: typeof knownBoot) => unknown;
    };
    expect(api.readClawxBootIdentityFromMainThread()).toBeUndefined();
    expect(wait).not.toHaveBeenCalled();
    workerThreads.isMainThread = true;
    expect(api.createClawxBootIdentityResponder(knownBoot)).toBeUndefined();
  });

  it('accepts only a reply from thread zero and exits when its main thread is idle', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'clawx-boot-identity-'));
    try {
      const fixture = path.join(temp, 'exercise.mjs');
      await writeFile(fixture, `
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker, isMainThread, parentPort, setEnvironmentData, workerData } from 'node:worker_threads';
import { createClawxBootIdentityResponder as responder, readClawxBootIdentityFromMainThread as read } from ${JSON.stringify(pathToFileURL(path.join(dist, helper)).href)};
const hint = 'clawx.gateway.windowsBootIdentity.v1';
const boot = ${JSON.stringify(knownBoot)};
const other = { ...boot, identity: '2000-01-01T00:00:00.0000000Z' };
const platform = (value) => Object.defineProperty(process, 'platform', { value, configurable: true });
platform('win32');
const launch = (kind, extra) => new Worker(new URL(import.meta.url), { workerData: { kind, ...extra } });
const result = async (worker) => (await once(worker, 'message'))[0];
async function readFromAvailableMain(kind) {
  // A slow scheduler can legitimately trigger the 35 ms fallback.
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = await result(launch(kind));
    if (value !== null) return value;
  }
  return null;
}
if (isMainThread) {
  process.argv[2] = 'gateway';
  setEnvironmentData(hint, true);
  assert.equal(responder(boot), undefined);
  Object.defineProperty(process, 'parentPort', { value: {} });
  process.argv[2] = 'doctor';
  assert.equal(responder(boot), undefined);
  process.argv[2] = 'gateway';
  platform('linux');
  assert.equal(responder(boot), undefined);
  platform('win32');
  setEnvironmentData(hint, undefined);
  assert.equal(responder(boot), undefined);
  setEnvironmentData(hint, other.identity);
  assert.equal(await result(launch('read')), null);
  setEnvironmentData(hint, true);
  assert.equal(responder({ ...boot, identity: 'bad' }), undefined);
  assert.equal(await result(launch('read')), null);
  process.on('workerMessage', responder(boot));
  assert.deepEqual(await readFromAvailableMain('read'), boot);
  assert.deepEqual(await readFromAvailableMain('nested'), boot);

  const latch = new Int32Array(new SharedArrayBuffer(4));
  const blocked = launch('blocked', { latch });
  assert.equal(await result(blocked), 'ready');
  const answer = result(blocked);
  blocked.postMessage('go');
  assert.notEqual(Atomics.wait(latch, 0, 0, 2000), 'timed-out');
  assert.equal(await answer, null);
} else if (workerData.kind === 'nested') {
  setEnvironmentData(hint, true);
  process.on('workerMessage', () => { throw new Error('Nested request went to the wrong thread'); });
  assert.equal(responder(other), undefined);
  parentPort.postMessage(await result(launch('read')));
} else {
  if (workerData.kind === 'blocked') {
    parentPort.postMessage('ready');
    await once(parentPort, 'message');
  }
  const answer = read() ?? null;
  if (workerData.latch) {
    Atomics.store(workerData.latch, 0, 1);
    Atomics.notify(workerData.latch, 0);
  }
  parentPort.postMessage(answer);
}
`);
      await promisify(execFile)(process.execPath, [fixture], { timeout: 8_000, windowsHide: true });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 12_000);
});

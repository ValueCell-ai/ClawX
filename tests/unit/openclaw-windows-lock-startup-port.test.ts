// @vitest-environment node
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtime = path.resolve(import.meta.dirname, '../../node_modules/openclaw');
const realQuery = "(Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')";
const recorded = '2026-09-16T22:18:26.6408920Z';
const ownerChunks = [
  'config-doctor/openclaw-state-db-cache-BBhRV-OR.js',
  'gateway-state-owner-record-iGXCdOwF.mjs',
  'infra/sqlite-readonly-location.worker.js',
  'managed-handoff-runtime.mjs',
  'native-hook-relay/worker-task-pool-DUF3lmpK.mjs',
  'package-update-activation-recovery.mjs',
  'process/supervisor/service-child-group-anchor.js',
  'state/openclaw-state-lease-heartbeat.worker.js',
  'state/openclaw-state-read-worker-cpu-Bm2AUN4y.mjs',
  'state-retention/openclaw-state-db-cache-R82_ufLk.js',
];

function declaration(source: string, name: string) {
  const found = source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  if (!found) throw new Error(`Missing ${name}`);
  return found[0];
}

type Completion = (error: Error | null, stdout?: string) => void;

async function makeGateway() {
  const source = await readFile(path.join(runtime, 'dist/clawx-windows-gateway-boot-identity.mjs'), 'utf8');
  const kill = vi.fn();
  let complete: Completion = () => { throw new Error('No OS query was launched'); };
  const execFile = vi.fn((_program: string, _args: string[], _options: unknown, callback: Completion) => {
    complete = callback;
    return { kill };
  });
  const process = Object.assign(new EventEmitter(), {
    platform: 'win32', argv: ['clawx', 'openclaw', 'gateway'], parentPort: {} as object | null,
    getBuiltinModule: () => ({ execFile }),
  });
  const workerThreads = {
    isMainThread: true,
    getEnvironmentData: vi.fn(() => true),
    postMessageToThread: vi.fn(),
  };
  const library = source.replace('import * as workerThreads from "node:worker_threads";', '').replaceAll('export function ', 'function ');
  const api = runInNewContext(`${library}\n({ prepareClawxWindowsBootIdentity, readClawxBootIdentityFromMainThread })`, {
    process, workerThreads,
  }) as { prepareClawxWindowsBootIdentity(): void; readClawxBootIdentityFromMainThread(): unknown };
  return {
    process, workerThreads, execFile, kill, complete: (error: Error | null, stdout?: string) => complete(error, stdout),
    prepare: api.prepareClawxWindowsBootIdentity, read: api.readClawxBootIdentityFromMainThread,
  };
}

describe('OpenClaw Windows lock startup compatibility', () => {
  it('prefetches the original 100 ns ISO representation only in the managed Windows gateway', async () => {
    const g = await makeGateway();
    g.process.platform = 'linux';
    g.prepare();
    g.process.platform = 'win32';
    g.workerThreads.getEnvironmentData.mockReturnValue(false);
    g.prepare();
    g.workerThreads.getEnvironmentData.mockReturnValue(true);
    g.process.parentPort = null;
    g.prepare();
    g.process.parentPort = {};
    g.process.argv[2] = 'doctor';
    g.prepare();
    g.process.argv[2] = 'gateway';
    g.workerThreads.isMainThread = false;
    g.prepare();
    expect(g.execFile).not.toHaveBeenCalled();
    g.workerThreads.isMainThread = true;
    g.prepare();
    g.prepare();
    expect(g.execFile).toHaveBeenCalledTimes(1);
    expect(g.execFile).toHaveBeenCalledWith('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', realQuery],
      expect.objectContaining({ timeout: 5000, windowsHide: true }), expect.any(Function));
    g.complete(null, recorded + '\r\n');
    expect(g.read()).toEqual({ platform: 'win32', identity: recorded });
    expect(g.process.listenerCount('exit')).toBe(0);
    expect(g.kill).not.toHaveBeenCalled();

    const entry = await readFile(path.join(runtime, 'openclaw.mjs'), 'utf8');
    expect(entry.indexOf('prepareClawxWindowsBootIdentity();')).toBeGreaterThan(0);
    expect(entry.indexOf('prepareClawxWindowsBootIdentity();')).toBeLessThan(entry.indexOf('if (await tryImport("./dist/entry.js"))'));
  });

  it('cancels an unfinished query on first synchronous demand or exit and discards its late reply', async () => {
    for (const ending of ['read', 'exit']) {
      const g = await makeGateway();
      g.prepare();
      if (ending === 'exit') g.process.emit('exit', 0);
      else expect(g.read()).toBeUndefined();
      g.complete(null, recorded);
      expect(g.read()).toBeUndefined();
      expect(g.kill).toHaveBeenCalledTimes(1);
      expect(g.process.listenerCount('exit')).toBe(0);
    }
  });

  it('leaves the original synchronous OS query available on failed, missing or invalid output', async () => {
    for (const [error, stdout] of [[new Error('Access denied'), recorded], [null, undefined], [null, recorded.slice(0, -2) + 'Z']] as const) {
      const g = await makeGateway();
      g.prepare();
      g.complete(error, stdout);
      expect(g.read()).toBeUndefined();
      expect(g.process.listenerCount('exit')).toBe(0);
    }
  });

  it('preserves the OS boot check on old records, including records without a process start time', async () => {
    const local = {host: 'workstation', platform: 'win32', identity: recorded};
    const read = vi.fn<() => typeof local | null>(() => local);
    const heartbeat = vi.fn(() => 0);
    for (const file of ownerChunks) {
      const source = await readFile(path.join(runtime, 'dist', file), 'utf8');
      expect(source).toContain('windowsBoot.extend({ host })');
      expect(declaration(source, 'createManagedHandoffBootIdentityReader')).toContain(realQuery);
      const classify = runInNewContext(`(${declaration(source, 'classifyGatewayOwnerProcessNamespace')})`, {
        process: { platform: 'win32' }, os: { hostname: () => local.host }, readGatewayLockProcessNamespace: read,
        GatewayProcessNamespaceSchema: { safeParse: (v?: typeof local) => ({ data: v?.identity ? v : undefined }) },
      }) as (ns: unknown, options?: {ownerHost?: string; readHeartbeatAt?: typeof heartbeat}) => string;
      read.mockClear();
      expect(classify(local)).toBe('same');
      expect(classify({ ...local, identity: '2000-01-02T03:04:05.0000000Z' })).toBe('dead');
      expect(read).toHaveBeenCalledTimes(2);
      // The 0.7.1 fallback leaves the decision to PID and native process identity when CIM fails.
      read.mockReturnValueOnce(null);
      expect(classify(local)).toBe('same');
      read.mockClear();
      expect(classify({ ...local, host: 'remote' }, { readHeartbeatAt: heartbeat })).toBe('unknown');
      expect(classify(local, { ownerHost: 'remote' })).toBe('unknown');
      expect(classify({ host: local.host, platform: 'win32' })).toBe('unknown');
      expect(classify({ ...local, platform: 'linux' })).toBe('unknown');
      expect(classify(undefined, { ownerHost: 'remote', readHeartbeatAt: heartbeat })).toBe('unknown');
      // 0.6.1 wrote the PID, configPath, port and createdAt, with no Windows namespace.
      expect(classify(undefined)).toBe('same');
      expect(classify(null, { ownerHost: local.host })).toBe('same');
      expect(read).not.toHaveBeenCalled();
    }
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('keeps read and reclamation decisions consistent for missing start times, a recycled PID and stale heartbeats', async () => {
    const local = { host: 'workstation', platform: 'win32', identity: recorded };
    const oldBoot = { ...local, identity: '2000-01-02T03:04:05.0000000Z' };
    const ownerChunk = await readFile(path.join(runtime, 'dist/gateway-state-owner-record-iGXCdOwF.mjs'), 'utf8');
    const classify = runInNewContext(`(${declaration(ownerChunk, 'classifyGatewayOwnerProcessNamespace')})`, {
      process: { platform: 'win32' }, os: { hostname: () => local.host }, readGatewayLockProcessNamespace: () => local,
      GatewayProcessNamespaceSchema: { safeParse: (v?: typeof local) => ({ data: v?.identity ? v : undefined }) },
    });
    const disk = await readFile(path.join(runtime, 'dist/gateway-lock-CcIPEAYy.mjs'), 'utf8');
    const diskReclaim = runInNewContext([
      declaration(disk, 'resolveGatewayOwnerStatusSync'), declaration(disk, 'shouldReclaimGatewayLock'), 'shouldReclaimGatewayLock',
    ].join('\n'), {
      classifyGatewayLockProcessNamespace: (ns: unknown) => classify(ns), isPidAlive: () => true,
      CMDLINE_EXEC_TIMEOUT_MS: 1000, GatewayLockNamespaceError: Error, classifyOpenClawArgv: () => ({ kind: 'openclaw' }),
    }) as (opts: object) => boolean;
    const file = {
      platform: 'win32', payload: { pid: 42, processNamespace: local }, readProcessStartTime: () => 100,
      readProcessCmdline: () => ['openclaw', 'gateway'], lockPath: 'gateway.lock',
    };
    expect(diskReclaim(file)).toBe(false);
    expect(diskReclaim({ ...file, readProcessCmdline: () => null })).toBe(false);
    expect(diskReclaim({ ...file, payload: { ...file.payload, startTime: 99 } })).toBe(true);
    expect(diskReclaim({ ...file, payload: { ...file.payload, processNamespace: oldBoot } })).toBe(true);
    expect(() => diskReclaim({ ...file, payload: { ...file.payload, processNamespace: { ...local, host: 'remote' } } })).toThrow();

    const stateLease = await readFile(path.join(runtime, 'dist/state/openclaw-state-read-gateway-owner-lease.read-BZtzipIX.mjs'), 'utf8');
    const startTime = vi.fn<(pid: number) => number | null>(() => 1000);
    const status = runInNewContext(`(${declaration(stateLease, 'readStateLeaseProcessOwnerStatus')})`, {
      classifyGatewayOwnerProcessNamespace: classify, isPidDefinitelyDead: () => false, getFileLockProcessStartTime: startTime,
    }) as (owner: unknown) => string;
    const owner = { pid: 42, host: local.host, startedAt: 1000, processNamespace: local };
    expect(status(owner)).toBe('live');
    expect(status({ ...owner, processNamespace: oldBoot, startedAt: null })).toBe('dead');
    expect(status({ ...owner, startedAt: null })).toBe('unknown');
    expect(status({ ...owner, host: 'remote' })).toBe('unknown');
    startTime.mockReturnValue(2000);
    expect(status(owner)).toBe('dead');
    startTime.mockReturnValue(null);
    expect(status(owner)).toBe('unknown');

    const leaseChunk = await readFile(path.join(runtime, 'dist/gateway-owner-lease-Bo_AN-kL.mjs'), 'utf8');
    const resolveStopped = runInNewContext(`(${declaration(leaseChunk, 'resolveStoppedGatewayOwnerLease')})`, {
      classifyGatewayOwnerProcessNamespace: classify, GatewayLockNamespaceError: Error, describeGatewayLockHolder: () => 'owner',
    }) as (lease: object) => unknown;
    const lease = { ...owner, state: 'unknown', heartbeatAt: 0, expired: false };
    expect(() => resolveStopped(lease)).toThrow();
    expect(() => resolveStopped({ ...lease, expired: true, state: 'live' })).toThrow();
    expect(() => resolveStopped({ ...lease, expired: true, host: 'remote' })).toThrow();
    const expired = { ...lease, expired: true };
    expect(resolveStopped(expired)).toBe(expired);
    const previousBoot = { ...lease, processNamespace: oldBoot, startedAt: null, state: 'dead' };
    expect(resolveStopped(previousBoot)).toBe(previousBoot);
  });
});

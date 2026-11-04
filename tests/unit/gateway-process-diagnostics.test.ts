// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppMetrics: vi.fn(),
  getVersion: vi.fn(),
  cpus: vi.fn(),
  freemem: vi.fn(),
  totalmem: vi.fn(),
  release: vi.fn(),
}));

vi.mock('electron', () => ({ app: {
  getAppMetrics: mocks.getAppMetrics,
  getVersion: mocks.getVersion,
} }));
vi.mock('node:os', () => ({
  cpus: mocks.cpus,
  freemem: mocks.freemem,
  totalmem: mocks.totalmem,
  release: mocks.release,
}));

import { app } from 'electron';
import {
  collectGatewayProcessDiagnostics,
  getGatewayDiagnosticEnvironment,
} from '@electron/gateway/process-diagnostics';

describe('Gateway process diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T05:47:00.000Z'));
    mocks.freemem.mockReturnValue(3.5 * 1024 ** 3);
    mocks.totalmem.mockReturnValue(16 * 1024 ** 3);
    mocks.cpus.mockReturnValue(Array.from({ length: 8 }, () => ({ model: 'private CPU model' })));
    mocks.release.mockReturnValue('10.0.26100');
    mocks.getVersion.mockReturnValue('0.7.0-biz.0');
    mocks.getAppMetrics.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('selects only the requested process and converts native memory units to MiB', () => {
    mocks.getAppMetrics.mockReturnValue([
      { pid: 999, name: 'private renderer title', cpu: { percentCPUUsage: 90 }, memory: { workingSetSize: 1 } },
      {
        pid: 123,
        creationTime: 123456,
        name: 'private process name',
        commandLine: 'token=secret',
        cpu: { percentCPUUsage: 12.5, cumulativeCPUUsage: 42.25, idleWakeupsPerSecond: 4 },
        memory: { workingSetSize: 512 * 1024, peakWorkingSetSize: 768 * 1024, privateBytes: 256 * 1024 },
      },
    ]);

    const sample = collectGatewayProcessDiagnostics(123);
    expect(sample).toEqual({
      sampledAt: Date.now(), pid: 123, availability: 'available', creationTime: 123456,
      cpuPercent: 12.5, cpuCumulativeSeconds: 42.25, workingSetMiB: 512,
      peakWorkingSetMiB: 768, privateMemoryMiB: 256, systemFreeMemoryMiB: 3584,
    });
    expect(JSON.stringify(sample)).not.toMatch(/private process|secret|999|renderer|commandLine/i);
  });

  it('distinguishes a measured zero from unavailable optional fields', () => {
    mocks.getAppMetrics.mockReturnValue([{
      pid: 123, creationTime: 1,
      cpu: { percentCPUUsage: 0 },
      memory: { workingSetSize: 0, peakWorkingSetSize: 0 },
    }]);
    const sample = collectGatewayProcessDiagnostics(123);
    expect(sample.availability).toBe('available');
    expect(sample.cpuPercent).toBe(0);
    expect(sample.workingSetMiB).toBe(0);
    expect(sample.cpuCumulativeSeconds).toBeUndefined();
    expect(sample.privateMemoryMiB).toBeUndefined();
    expect(JSON.stringify(sample)).not.toContain('privateMemoryMiB');
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not query process metrics without a valid owned pid (%s)', (pid) => {
      expect(collectGatewayProcessDiagnostics(pid)).toMatchObject({
        availability: 'unavailable', unavailableReason: 'no-pid', systemFreeMemoryMiB: 3584,
      });
      expect(mocks.getAppMetrics).not.toHaveBeenCalled();
    },
  );

  it('distinguishes an exited or unlisted process from zero CPU activity', () => {
    mocks.getAppMetrics.mockReturnValue([{ pid: 999, cpu: { percentCPUUsage: 0 } }]);
    const sample = collectGatewayProcessDiagnostics(123);
    expect(sample).toMatchObject({ pid: 123, availability: 'unavailable', unavailableReason: 'not-found' });
    expect(sample.cpuPercent).toBeUndefined();
  });

  it('tolerates unsupported metric APIs', () => {
    const original = app.getAppMetrics;
    Object.defineProperty(app, 'getAppMetrics', { value: undefined, configurable: true });
    try {
      expect(collectGatewayProcessDiagnostics(123)).toMatchObject({
        availability: 'unavailable', unavailableReason: 'unsupported',
      });
    } finally {
      Object.defineProperty(app, 'getAppMetrics', { value: original, configurable: true });
    }
  });

  it('contains metric and OS errors without logging their potentially sensitive messages', () => {
    mocks.getAppMetrics.mockImplementation(() => { throw new Error('private path token=secret'); });
    mocks.freemem.mockImplementation(() => { throw new Error('private OS error'); });
    const sample = collectGatewayProcessDiagnostics(123);
    expect(sample).toMatchObject({ availability: 'unavailable', unavailableReason: 'read-failed' });
    expect(sample.systemFreeMemoryMiB).toBeUndefined();
    expect(JSON.stringify(sample)).not.toMatch(/private|secret|token/);
  });

  it('omits invalid native numeric values rather than serializing NaN, infinity or negative sizes', () => {
    mocks.freemem.mockReturnValue(-1);
    mocks.getAppMetrics.mockReturnValue([{
      pid: 123, creationTime: Number.NaN,
      cpu: { percentCPUUsage: Number.POSITIVE_INFINITY, cumulativeCPUUsage: -1 },
      memory: { workingSetSize: -1, peakWorkingSetSize: Number.NaN, privateBytes: '1024' },
    }]);
    const sample = collectGatewayProcessDiagnostics(123);
    expect(sample.availability).toBe('partial');
    expect(JSON.parse(JSON.stringify(sample))).toEqual({ sampledAt: Date.now(), pid: 123, availability: 'partial' });
  });

  it('captures only allowlisted environment facts with explicit memory units', () => {
    const environment = getGatewayDiagnosticEnvironment();
    expect(environment).toEqual({
      platform: process.platform, arch: process.arch, osRelease: '10.0.26100',
      logicalCpuCount: 8, totalMemoryMiB: 16384, freeMemoryMiB: 3584,
      clawxVersion: '0.7.0-biz.0', electronVersion: process.versions.electron,
      embeddedNodeVersion: process.versions.node,
    });
    expect(JSON.stringify(environment)).not.toMatch(/private|hostname|username|model|commandLine/);
  });

  it('keeps environment collection best-effort and does not expose malformed version strings', () => {
    mocks.getVersion.mockImplementation(() => { throw new Error('secret'); });
    mocks.cpus.mockImplementation(() => { throw new Error('secret'); });
    mocks.totalmem.mockReturnValue(Number.POSITIVE_INFINITY);
    mocks.freemem.mockReturnValue(Number.NaN);
    mocks.release.mockReturnValue('unexpected os=secret\n');
    const environment = getGatewayDiagnosticEnvironment();
    expect(environment).toMatchObject({ platform: process.platform, arch: process.arch });
    expect(environment.clawxVersion).toBeUndefined();
    expect(environment.logicalCpuCount).toBeUndefined();
    expect(environment.totalMemoryMiB).toBeUndefined();
    expect(environment.freeMemoryMiB).toBeUndefined();
    expect(environment.osRelease).toBeUndefined();
    expect(JSON.stringify(environment)).not.toContain('secret');
  });
});

import { app } from 'electron';
import { cpus, freemem, release, totalmem } from 'node:os';

export type GatewayDiagnosticEnvironment = {
  platform: NodeJS.Platform;
  arch: string;
  osRelease?: string;
  logicalCpuCount?: number;
  totalMemoryMiB?: number;
  freeMemoryMiB?: number;
  clawxVersion?: string;
  electronVersion?: string;
  embeddedNodeVersion?: string;
};

export type GatewayProcessDiagnostics = {
  sampledAt: number;
  pid?: number;
  availability: 'available' | 'partial' | 'unavailable';
  unavailableReason?: 'no-pid' | 'unsupported' | 'not-found' | 'read-failed';
  creationTime?: number;
  // Electron reports interval CPU usage; its first native sample can be zero.
  cpuPercent?: number;
  cpuCumulativeSeconds?: number;
  workingSetMiB?: number;
  peakWorkingSetMiB?: number;
  privateMemoryMiB?: number;
  systemFreeMemoryMiB?: number;
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readSafely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    // Diagnostics must not disrupt lifecycle operations or expose raw errors.
    return undefined;
  }
}

function memoryMiB(value: unknown, unitsPerMiB: number): number | undefined {
  const amount = finiteNonNegative(value);
  if (amount === undefined) return undefined;
  return Math.round((amount / unitsPerMiB) * 100) / 100;
}

function versionString(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(value)
    ? value
    : undefined;
}

/** Allowlisted host facts only: no user, hostname, paths, environment or CPU model. */
export function getGatewayDiagnosticEnvironment(): GatewayDiagnosticEnvironment {
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: versionString(readSafely(() => release())),
    logicalCpuCount: finiteNonNegative(readSafely(() => cpus().length)),
    totalMemoryMiB: memoryMiB(readSafely(() => totalmem()), 1024 * 1024),
    freeMemoryMiB: memoryMiB(readSafely(() => freemem()), 1024 * 1024),
    clawxVersion: versionString(readSafely(() => app.getVersion())),
    electronVersion: versionString(process.versions.electron),
    embeddedNodeVersion: versionString(process.versions.node),
  };
}

/**
 * Observe one owned Gateway from Main, even when its event loop is unresponsive.
 * Electron memory metrics are KiB; host OS memory is bytes. Do not copy complete
 * ProcessMetric objects: they may contain names or details of unrelated processes.
 */
export function collectGatewayProcessDiagnostics(pid?: number): GatewayProcessDiagnostics {
  const snapshot: GatewayProcessDiagnostics = {
    sampledAt: Date.now(),
    availability: 'unavailable',
    systemFreeMemoryMiB: memoryMiB(readSafely(() => freemem()), 1024 * 1024),
  };
  if (!Number.isSafeInteger(pid) || pid! <= 0) {
    return { ...snapshot, unavailableReason: 'no-pid' };
  }
  snapshot.pid = pid;

  try {
    if (typeof app.getAppMetrics !== 'function') {
      return { ...snapshot, unavailableReason: 'unsupported' };
    }
    const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
    if (!metric) return { ...snapshot, unavailableReason: 'not-found' };

    const cpuPercent = finiteNonNegative(metric.cpu?.percentCPUUsage);
    const workingSetMiB = memoryMiB(metric.memory?.workingSetSize, 1024);
    return {
      ...snapshot,
      availability: cpuPercent === undefined || workingSetMiB === undefined ? 'partial' : 'available',
      creationTime: finiteNonNegative(metric.creationTime),
      cpuPercent,
      cpuCumulativeSeconds: finiteNonNegative(metric.cpu?.cumulativeCPUUsage),
      workingSetMiB,
      peakWorkingSetMiB: memoryMiB(metric.memory?.peakWorkingSetSize, 1024),
      privateMemoryMiB: memoryMiB(metric.memory?.privateBytes, 1024),
    };
  } catch {
    return { ...snapshot, unavailableReason: 'read-failed' };
  }
}

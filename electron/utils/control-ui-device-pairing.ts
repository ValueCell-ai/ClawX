import { app, utilityProcess } from 'electron';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PORTS } from './config';
import { prependPathEntry } from './env-path';
import { logger } from './logger';
import { getOpenClawConfigDir, getOpenClawDir, getOpenClawEntryPath } from './paths';
import { getSetting } from './store';
import { getUvMirrorEnv } from './uv-env';

/** Browser Control UI client id used in OpenClaw 2026.5.x connect frames. */
export const CONTROL_UI_BROWSER_CLIENT_ID = 'openclaw-control-ui';

export type PendingDevicePairingRequest = {
  requestId?: string;
  clientId?: string;
  clientMode?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  platform?: string;
};

export type DevicePairingList = {
  pending?: PendingDevicePairingRequest[];
  paired?: unknown[];
};

export type GatewayPairingRpcClient = {
  isConnected: () => boolean;
  getStatus?: () => { port?: number };
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
};

const DEFAULT_POLL_INTERVAL_MS = 800;
const DEFAULT_WATCH_TIMEOUT_MS = 90_000;
const LIST_RPC_TIMEOUT_MS = 10_000;
const APPROVE_RPC_TIMEOUT_MS = 15_000;
const CLI_APPROVE_TIMEOUT_MS = 20_000;

let activeWatcher: { cancel: () => void } | null = null;

export function isControlUiBrowserPairingRequest(request: PendingDevicePairingRequest): boolean {
  const clientId = typeof request.clientId === 'string' ? request.clientId.trim() : '';
  return clientId === CONTROL_UI_BROWSER_CLIENT_ID;
}

function parseDevicePairingList(value: unknown): DevicePairingList {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    pending: Array.isArray(record.pending)
      ? (record.pending as PendingDevicePairingRequest[])
      : [],
    paired: Array.isArray(record.paired) ? record.paired : [],
  };
}

function resolveGatewayPort(gateway: GatewayPairingRpcClient): number {
  return gateway.getStatus?.()?.port ?? PORTS.OPENCLAW_GATEWAY;
}

function resolveWatchTimeoutMs(explicit?: number): number {
  return typeof explicit === 'number' ? explicit : DEFAULT_WATCH_TIMEOUT_MS;
}

/** Read ~/.openclaw/devices/pending.json (same store the Gateway uses on loopback). */
export async function readLocalPendingPairingRequests(): Promise<PendingDevicePairingRequest[]> {
  const pendingPath = join(getOpenClawConfigDir(), 'devices', 'pending.json');
  try {
    const raw = await readFile(pendingPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, PendingDevicePairingRequest>;
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.values(parsed).filter((entry) => entry && typeof entry === 'object');
  } catch {
    return [];
  }
}

async function listPendingPairingRequests(gateway: GatewayPairingRpcClient): Promise<PendingDevicePairingRequest[]> {
  const merged = new Map<string, PendingDevicePairingRequest>();

  for (const request of await readLocalPendingPairingRequests()) {
    const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : '';
    if (requestId) merged.set(requestId, request);
  }

  if (gateway.isConnected()) {
    try {
      const list = parseDevicePairingList(
        await gateway.rpc<unknown>('device.pair.list', {}, LIST_RPC_TIMEOUT_MS),
      );
      for (const request of list.pending ?? []) {
        const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : '';
        if (requestId) merged.set(requestId, request);
      }
    } catch (error) {
      logger.debug(`[control-ui] device.pair.list RPC failed, using local pending file: ${String(error)}`);
    }
  }

  return [...merged.values()];
}

function getBundledBinPath(): string {
  const target = `${process.platform}-${process.arch}`;
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(process.cwd(), 'resources', 'bin', target);
}

/**
 * Run `openclaw devices approve` in-process (not shown to the user).
 * OpenClaw falls back to local pending.json on loopback when RPC is unavailable.
 */
async function approveViaOpenClawCli(requestId: string, _port: number): Promise<boolean> {
  const entryScript = getOpenClawEntryPath();
  const openclawDir = getOpenClawDir();
  if (!existsSync(entryScript)) {
    logger.warn('[control-ui] Cannot run devices approve: OpenClaw entry missing');
    return false;
  }

  const token = await getSetting('gatewayToken');
  const args = ['devices', 'approve', requestId, '--token', token, '--timeout', String(CLI_APPROVE_TIMEOUT_MS)];

  const binPath = getBundledBinPath();
  const binPathExists = existsSync(binPath);
  const baseEnv = (binPathExists
    ? prependPathEntry(process.env as Record<string, string | undefined>, binPath).env
    : process.env) as Record<string, string | undefined>;
  const uvEnv = await getUvMirrorEnv();

  return await new Promise<boolean>((resolve) => {
    const child = utilityProcess.fork(entryScript, args, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: {
        ...baseEnv,
        ...uvEnv,
        OPENCLAW_NO_RESPAWN: '1',
        OPENCLAW_EMBEDDED_IN: 'ClawX',
      } as NodeJS.ProcessEnv,
    });

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timeout = setTimeout(() => {
      logger.warn(`[control-ui] devices approve timed out for ${requestId}`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(false);
    }, CLI_APPROVE_TIMEOUT_MS + 5_000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      logger.warn(`[control-ui] devices approve spawn failed: ${String(error)}`);
      finish(false);
    });

    child.on('exit', (code: number) => {
      clearTimeout(timeout);
      finish(code === 0);
    });
  });
}

async function approvePairingRequest(
  gateway: GatewayPairingRpcClient,
  requestId: string,
  port: number,
): Promise<boolean> {
  if (gateway.isConnected()) {
    try {
      await gateway.rpc('device.pair.approve', { requestId }, APPROVE_RPC_TIMEOUT_MS);
      return true;
    } catch (error) {
      logger.debug(
        `[control-ui] device.pair.approve RPC failed for ${requestId}, trying CLI fallback: ${String(error)}`,
      );
    }
  }

  return approveViaOpenClawCli(requestId, port);
}

function sleep(ms: number, signal: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (signal.cancelled) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      clearTimeout(timer);
      resolve();
    }, ms);
  });
}

/**
 * Approve pending Control UI browser pairing requests.
 * Uses Gateway RPC when available; falls back to local pending.json + embedded CLI on Windows packaged builds.
 */
export async function approvePendingControlUiPairingRequests(
  gateway: GatewayPairingRpcClient,
  options?: { approvedRequestIds?: Set<string> },
): Promise<string[]> {
  const port = resolveGatewayPort(gateway);
  const approvedRequestIds = options?.approvedRequestIds ?? new Set<string>();
  const pending = await listPendingPairingRequests(gateway);

  const approved: string[] = [];
  for (const request of pending) {
    if (!isControlUiBrowserPairingRequest(request)) continue;

    const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : '';
    if (!requestId || approvedRequestIds.has(requestId)) continue;

    try {
      const ok = await approvePairingRequest(gateway, requestId, port);
      if (!ok) continue;
      approvedRequestIds.add(requestId);
      approved.push(requestId);
      logger.info(
        `[control-ui] Auto-approved browser device pairing (requestId=${requestId}, mode=${request.clientMode ?? 'unknown'})`,
      );
    } catch (error) {
      logger.warn(
        `[control-ui] Failed to auto-approve pairing request ${requestId}: ${String(error)}`,
      );
    }
  }

  return approved;
}

async function watchControlUiPairingApprovals(
  gateway: GatewayPairingRpcClient,
  signal: { cancelled: boolean },
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<void> {
  const approvedRequestIds = new Set<string>();
  const deadline = Date.now() + timeoutMs;

  while (!signal.cancelled && Date.now() < deadline) {
    try {
      await approvePendingControlUiPairingRequests(gateway, { approvedRequestIds });
    } catch (error) {
      logger.debug(`[control-ui] Pairing poll error: ${String(error)}`);
    }

    await sleep(pollIntervalMs, signal);
  }
}

/**
 * Poll for Control UI browser pairing requests and approve them locally.
 * Safe to call repeatedly; only one watcher runs at a time.
 */
export function scheduleControlUiDeviceAutoApproval(
  gateway: GatewayPairingRpcClient,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): void {
  activeWatcher?.cancel();

  const signal = { cancelled: false };
  const cancel = () => {
    signal.cancelled = true;
  };
  activeWatcher = { cancel };

  const timeoutMs = resolveWatchTimeoutMs(options?.timeoutMs);
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  void watchControlUiPairingApprovals(gateway, signal, timeoutMs, pollIntervalMs)
    .catch((error) => {
      logger.warn(`[control-ui] Auto-approval watcher failed: ${String(error)}`);
    })
    .finally(() => {
      if (activeWatcher?.cancel === cancel) {
        activeWatcher = null;
      }
    });
}

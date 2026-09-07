import { isChannelRuntimeConnected, type ChannelRuntimeAccountSnapshot } from '../utils/channel-status';
import { logger } from '../utils/logger';

export const PLUGIN_CHANNEL_HOT_WAIT_MS = 6_000;
export const PLUGIN_CHANNEL_POLL_INTERVAL_MS = 500;
export const PLUGIN_CHANNEL_POST_RESTART_WAIT_MS = 8_000;
export const PLUGIN_CHANNEL_STATUS_RPC_TIMEOUT_MS = 2_000;

export type PluginChannelActivationResult =
  | 'already-live'
  | 'hot-activated'
  | 'restarted'
  | 'unavailable';

export type PluginChannelActivationGateway = {
  getStatus: () => { state: string; gatewayReady?: boolean };
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  restart: () => Promise<void>;
};

export type PluginChannelActivationStatusPayload = {
  channelAccounts?: Record<string, Array<{
    accountId?: string;
    connected?: boolean;
    running?: boolean;
    linked?: boolean;
    lastError?: string;
    probe?: { ok?: boolean } | null;
  }>>;
};

export type PluginChannelActivationOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  hotWaitMs?: number;
  pollIntervalMs?: number;
  postRestartWaitMs?: number;
  rpcTimeoutMs?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `state === 'running'` flips at the WebSocket handshake; `gatewayReady` only
 * after OpenClaw reports its plugins/skills loaded. Between the two (e.g. right
 * after a code-1012 config reload) channels are still starting, so a forced
 * restart there would stack a second restart on top of the native one.
 */
function isGatewayReadyForForcedRestart(status: { state: string; gatewayReady?: boolean }): boolean {
  return status.state === 'running' && status.gatewayReady === true;
}

function unnamedDefaultAccountFallback<T extends { accountId?: string }>(
  accounts: T[],
  requested: string,
): T | undefined {
  if (requested !== 'default' || accounts.length !== 1) return undefined;
  const only = accounts[0];
  const current = typeof only.accountId === 'string' ? only.accountId.trim() : '';
  return current ? undefined : only;
}

function isAccountSnapshotLive(
  accounts: Array<{
    accountId?: string;
    connected?: boolean;
    running?: boolean;
    linked?: boolean;
    lastError?: string;
    probe?: { ok?: boolean } | null;
  }> | undefined,
  accountId: string,
): boolean {
  if (!accounts?.length) return false;
  const requested = accountId.trim();
  const matched = accounts.find((account) => {
    const current = typeof account.accountId === 'string' ? account.accountId.trim() : '';
    return current === requested;
  }) ?? unnamedDefaultAccountFallback(accounts, requested);
  if (!matched) return false;
  const snapshot: ChannelRuntimeAccountSnapshot = {
    connected: matched.connected,
    running: matched.running,
    linked: matched.linked,
    lastError: matched.lastError,
    probe: matched.probe,
  };
  return isChannelRuntimeConnected(snapshot);
}

type PluginChannelStatusRead =
  | { ok: true; live: boolean }
  | { ok: false };

async function readPluginChannelStatus(
  gateway: PluginChannelActivationGateway,
  storedChannelType: string,
  accountId: string,
  rpcTimeoutMs: number,
): Promise<PluginChannelStatusRead> {
  try {
    const status = await gateway.rpc<PluginChannelActivationStatusPayload>(
      'channels.status',
      { probe: false },
      rpcTimeoutMs,
    );
    return { ok: true, live: isAccountSnapshotLive(status?.channelAccounts?.[storedChannelType], accountId) };
  } catch {
    return { ok: false };
  }
}

export async function readPluginChannelLive(
  gateway: PluginChannelActivationGateway,
  storedChannelType: string,
  accountId: string,
  rpcTimeoutMs = PLUGIN_CHANNEL_STATUS_RPC_TIMEOUT_MS,
): Promise<boolean> {
  const read = await readPluginChannelStatus(gateway, storedChannelType, accountId, rpcTimeoutMs);
  return read.ok && read.live;
}

export async function ensurePluginChannelRuntimeActivated(
  gateway: PluginChannelActivationGateway,
  storedChannelType: string,
  accountId: string,
  options: PluginChannelActivationOptions = {},
): Promise<PluginChannelActivationResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const hotWaitMs = options.hotWaitMs ?? PLUGIN_CHANNEL_HOT_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? PLUGIN_CHANNEL_POLL_INTERVAL_MS;
  const postRestartWaitMs = options.postRestartWaitMs ?? PLUGIN_CHANNEL_POST_RESTART_WAIT_MS;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? PLUGIN_CHANNEL_STATUS_RPC_TIMEOUT_MS;
  const resolvedAccountId = accountId.trim() || 'default';

  const initialState = gateway.getStatus().state;
  if (initialState === 'stopped' || initialState === 'error') {
    logger.info(
      `[plugin-channel-activation] skip channel=${storedChannelType} account=${resolvedAccountId} reason=gateway-${initialState}`,
    );
    return 'unavailable';
  }

  let sawSuccessfulStatus = false;
  const initialRead = await readPluginChannelStatus(gateway, storedChannelType, resolvedAccountId, rpcTimeoutMs);
  if (initialRead.ok) {
    sawSuccessfulStatus = true;
    if (initialState === 'running' && initialRead.live) {
      return 'already-live';
    }
  }

  const hotDeadline = now() + hotWaitMs;
  while (now() < hotDeadline) {
    await sleep(pollIntervalMs);
    const hotRead = await readPluginChannelStatus(gateway, storedChannelType, resolvedAccountId, rpcTimeoutMs);
    if (!hotRead.ok) continue;
    sawSuccessfulStatus = true;
    if (hotRead.live) {
      logger.info(
        `[plugin-channel-activation] hot-activated channel=${storedChannelType} account=${resolvedAccountId}`,
      );
      return 'hot-activated';
    }
  }

  if (!sawSuccessfulStatus) {
    logger.info(
      `[plugin-channel-activation] skip restart channel=${storedChannelType} account=${resolvedAccountId} reason=status-rpc-failed`,
    );
    return 'unavailable';
  }

  const statusAfterWait = gateway.getStatus();
  if (!isGatewayReadyForForcedRestart(statusAfterWait)) {
    logger.info(
      `[plugin-channel-activation] skip restart channel=${storedChannelType} account=${resolvedAccountId} state=${statusAfterWait.state} ready=${statusAfterWait.gatewayReady === true ? '1' : '0'}`,
    );
    return 'unavailable';
  }

  logger.warn(
    `[plugin-channel-activation] channel=${storedChannelType} account=${resolvedAccountId} still missing from channels.status after ${hotWaitMs}ms; forcing Gateway restart (aborts in-flight Gateway work)`,
  );
  try {
    await gateway.restart();
  } catch (error) {
    // The config and binding are already committed; GatewayManager owns restart
    // recovery and status propagation, so a failed restart must not turn a
    // successful save or QR login into an error for the user.
    logger.warn(
      `[plugin-channel-activation] forced Gateway restart failed channel=${storedChannelType} account=${resolvedAccountId}:`,
      error,
    );
    return 'unavailable';
  }

  const restartDeadline = now() + postRestartWaitMs;
  while (now() < restartDeadline) {
    if (await readPluginChannelLive(gateway, storedChannelType, resolvedAccountId, rpcTimeoutMs)) {
      return 'restarted';
    }
    await sleep(pollIntervalMs);
  }

  return 'restarted';
}

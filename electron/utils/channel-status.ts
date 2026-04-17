export type GatewayHealthState = 'healthy' | 'degraded' | 'unresponsive';
export type ChannelConnectionStatus = 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';

export interface ChannelRuntimeAccountSnapshot {
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string | null;
  lastConnectedAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  probe?: {
    ok?: boolean | null;
  } | null;
}

export interface ChannelRuntimeSummarySnapshot {
  error?: string | null;
  lastError?: string | null;
}

export interface ChannelHealthOverlay {
  gatewayHealthState?: GatewayHealthState;
}

const RECENT_ACTIVITY_MS = 10 * 60 * 1000;

function hasNonEmptyError(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasRecentChannelActivity(
  account: Pick<ChannelRuntimeAccountSnapshot, 'lastConnectedAt' | 'lastInboundAt' | 'lastOutboundAt'>,
  now = Date.now(),
  recentMs = RECENT_ACTIVITY_MS,
): boolean {
  return (
    (typeof account.lastInboundAt === 'number' && now - account.lastInboundAt < recentMs) ||
    (typeof account.lastOutboundAt === 'number' && now - account.lastOutboundAt < recentMs) ||
    (typeof account.lastConnectedAt === 'number' && now - account.lastConnectedAt < recentMs)
  );
}

export function hasSuccessfulChannelProbe(
  account: Pick<ChannelRuntimeAccountSnapshot, 'probe'>,
): boolean {
  return account.probe?.ok === true;
}

export function hasChannelRuntimeError(
  account: Pick<ChannelRuntimeAccountSnapshot, 'lastError'>,
): boolean {
  return hasNonEmptyError(account.lastError);
}

export function hasSummaryRuntimeError(
  summary: ChannelRuntimeSummarySnapshot | undefined,
): boolean {
  if (!summary) return false;
  return hasNonEmptyError(summary.error) || hasNonEmptyError(summary.lastError);
}

export function isChannelRuntimeConnected(
  account: ChannelRuntimeAccountSnapshot,
): boolean {
  if (account.connected === true || account.linked === true) {
    return true;
  }

  if (hasRecentChannelActivity(account) || hasSuccessfulChannelProbe(account)) {
    return true;
  }

  // OpenClaw integrations such as Feishu/WeCom may stay "running" without ever
  // setting a durable connected=true flag. Treat healthy running as connected.
  return account.running === true && !hasChannelRuntimeError(account);
}

export function computeChannelRuntimeStatus(
  account: ChannelRuntimeAccountSnapshot,
  healthOverlay?: ChannelHealthOverlay,
): ChannelConnectionStatus {
  if (hasChannelRuntimeError(account)) return 'error';
  if (healthOverlay?.gatewayHealthState && healthOverlay.gatewayHealthState !== 'healthy') return 'degraded';
  if (isChannelRuntimeConnected(account)) return 'connected';
  if (account.running === true) return 'connecting';
  return 'disconnected';
}

export function pickChannelRuntimeStatus(
  accounts: ChannelRuntimeAccountSnapshot[],
  summary?: ChannelRuntimeSummarySnapshot,
  healthOverlay?: ChannelHealthOverlay,
): ChannelConnectionStatus {
  if (accounts.some((account) => isChannelRuntimeConnected(account))) {
    return 'connected';
  }

  if (accounts.some((account) => hasChannelRuntimeError(account)) || hasSummaryRuntimeError(summary)) {
    return 'error';
  }

  if (healthOverlay?.gatewayHealthState && healthOverlay.gatewayHealthState !== 'healthy') {
    return 'degraded';
  }

  if (accounts.some((account) => account.running === true)) {
    return 'connecting';
  }

  return 'disconnected';
}

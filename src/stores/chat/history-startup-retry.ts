import type { GatewayStatus } from '@/types/gateway';

export const CHAT_HISTORY_RPC_TIMEOUT_MS = 35_000;
export const CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS = [600] as const;
export const CHAT_HISTORY_STARTUP_CONNECTION_GRACE_MS = 15_000;
export const CHAT_HISTORY_STARTUP_RUNNING_WINDOW_MS =
  CHAT_HISTORY_RPC_TIMEOUT_MS + CHAT_HISTORY_STARTUP_CONNECTION_GRACE_MS;
export const CHAT_HISTORY_DEFAULT_LOADING_SAFETY_TIMEOUT_MS = 15_000;
export const CHAT_HISTORY_LOADING_SAFETY_TIMEOUT_MS =
  CHAT_HISTORY_RPC_TIMEOUT_MS * (CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length + 1)
  + CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)
  + 2_000;

export type HistoryRetryErrorKind = 'timeout' | 'gateway_unavailable';

export function classifyHistoryStartupRetryError(error: unknown): HistoryRetryErrorKind | null {
  const message = String(error).toLowerCase();

  if (
    message.includes('rpc timeout: chat.history')
    || message.includes('gateway rpc timeout: chat.history')
    || message.includes('gateway ws timeout: chat.history')
    || message.includes('request timed out')
  ) {
    return 'timeout';
  }

  if (
    message.includes('gateway not connected')
    || message.includes('gateway socket is not connected')
    || message.includes('gateway is unavailable')
    || message.includes('service channel unavailable')
    || message.includes('websocket closed before handshake')
    || message.includes('connect handshake timeout')
    || message.includes('gateway ws connect timeout')
    || message.includes('gateway connection closed')
  ) {
    return 'gateway_unavailable';
  }

  return null;
}

export function shouldRetryStartupHistoryLoad(
  gatewayStatus: GatewayStatus | undefined,
  errorKind: HistoryRetryErrorKind | null,
): boolean {
  if (!gatewayStatus || !errorKind) return false;

  if (gatewayStatus.state === 'starting') {
    return true;
  }

  if (gatewayStatus.state !== 'running') {
    return false;
  }

  if (gatewayStatus.connectedAt == null) {
    return true;
  }

  return Date.now() - gatewayStatus.connectedAt <= CHAT_HISTORY_STARTUP_RUNNING_WINDOW_MS;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function getStartupHistoryTimeoutOverride(
  isInitialForegroundLoad: boolean,
): number | undefined {
  return isInitialForegroundLoad ? CHAT_HISTORY_RPC_TIMEOUT_MS : undefined;
}

export function getHistoryLoadingSafetyTimeout(isInitialForegroundLoad: boolean): number {
  return isInitialForegroundLoad
    ? CHAT_HISTORY_LOADING_SAFETY_TIMEOUT_MS
    : CHAT_HISTORY_DEFAULT_LOADING_SAFETY_TIMEOUT_MS;
}

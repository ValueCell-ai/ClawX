import type { GatewayStartupDiagnosticCode, GatewayStatus } from '@/types/gateway';

export const CHAT_HISTORY_RPC_TIMEOUT_MS = 35_000;

/**
 * Diagnostic codes that indicate the Gateway's chat.history will NOT
 * recover on its own — retrying is pointless.  The renderer should bail
 * out early and surface the diagnostic banner instead.
 */
const FATAL_STARTUP_DIAGNOSTIC_CODES: ReadonlySet<GatewayStartupDiagnosticCode> =
  new Set<GatewayStartupDiagnosticCode>(['ACPX_VC_REDIST_MISSING']);

/**
 * Returns true if the current Gateway status carries a fatal startup
 * diagnostic that makes further chat.history retries pointless.
 */
export function hasFatalStartupDiagnostic(
  gatewayStatus: GatewayStatus | undefined,
): boolean {
  const diagnostics = gatewayStatus?.activeDiagnostics;
  if (!diagnostics || diagnostics.length === 0) return false;
  return diagnostics.some((d) => FATAL_STARTUP_DIAGNOSTIC_CODES.has(d.code));
}
export const CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS = [800, 2_000, 4_000, 8_000] as const;
export const CHAT_HISTORY_STARTUP_CONNECTION_GRACE_MS = 30_000;
export const CHAT_HISTORY_STARTUP_RUNNING_WINDOW_MS =
  CHAT_HISTORY_RPC_TIMEOUT_MS + CHAT_HISTORY_STARTUP_CONNECTION_GRACE_MS;
export const CHAT_HISTORY_DEFAULT_LOADING_SAFETY_TIMEOUT_MS = 15_000;
export const CHAT_HISTORY_LOADING_SAFETY_TIMEOUT_MS =
  CHAT_HISTORY_RPC_TIMEOUT_MS * (CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length + 1)
  + CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0)
  + 2_000;

export type HistoryRetryErrorKind = 'timeout' | 'gateway_unavailable' | 'gateway_startup';

export function classifyHistoryStartupRetryError(error: unknown): HistoryRetryErrorKind | null {
  const message = String(error).toLowerCase();

  if (
    message.includes('unavailable during gateway startup')
    || message.includes('unavailable during startup')
    || message.includes('not yet ready')
    || message.includes('service not initialized')
  ) {
    return 'gateway_startup';
  }

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

  // A fatal startup diagnostic (e.g. ACPX_VC_REDIST_MISSING) means the
  // Gateway's plugin startup will not recover without user action.  Retries
  // will only burn 90+ seconds of UI hang and never succeed — bail out so
  // the banner can communicate the real problem.
  if (hasFatalStartupDiagnostic(gatewayStatus)) {
    return false;
  }

  // The gateway explicitly told us it's still initializing -- always retry
  if (errorKind === 'gateway_startup') {
    return true;
  }

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

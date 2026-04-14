import type {
  GatewayDiagnosticsSnapshot,
  GatewayHealthSummary,
  GatewayStatus,
} from '../gateway/manager';

type BuildGatewayHealthSummaryOptions = {
  status: GatewayStatus;
  diagnostics: GatewayDiagnosticsSnapshot;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
  platform?: string;
  now?: number;
};

const CHANNEL_STATUS_FAILURE_WINDOW_MS = 2 * 60_000;
const HEARTBEAT_MISS_THRESHOLD_DEFAULT = 3;
const HEARTBEAT_MISS_THRESHOLD_WIN = 5;

export function buildGatewayHealthSummary(
  options: BuildGatewayHealthSummaryOptions,
): GatewayHealthSummary {
  const now = options.now ?? Date.now();
  const reasons = new Set<string>();
  const heartbeatThreshold = options.platform === 'win32'
    ? HEARTBEAT_MISS_THRESHOLD_WIN
    : HEARTBEAT_MISS_THRESHOLD_DEFAULT;

  const channelStatusFailureIsRecent =
    typeof options.lastChannelsStatusFailureAt === 'number'
    && now - options.lastChannelsStatusFailureAt <= CHANNEL_STATUS_FAILURE_WINDOW_MS
    && (
      typeof options.lastChannelsStatusOkAt !== 'number'
      || options.lastChannelsStatusFailureAt > options.lastChannelsStatusOkAt
    );

  if (options.status.state !== 'running') {
    reasons.add(options.status.state === 'error' ? 'gateway_error' : 'gateway_not_running');
    return {
      state: 'degraded',
      reasons: [...reasons],
      consecutiveHeartbeatMisses: options.diagnostics.consecutiveHeartbeatMisses,
      lastAliveAt: options.diagnostics.lastAliveAt,
      lastRpcSuccessAt: options.diagnostics.lastRpcSuccessAt,
      lastRpcFailureAt: options.diagnostics.lastRpcFailureAt,
      lastRpcFailureMethod: options.diagnostics.lastRpcFailureMethod,
      lastChannelsStatusOkAt: options.lastChannelsStatusOkAt,
      lastChannelsStatusFailureAt: options.lastChannelsStatusFailureAt,
    };
  }

  if (options.diagnostics.consecutiveHeartbeatMisses >= heartbeatThreshold) {
    reasons.add('gateway_unresponsive');
  } else if (options.diagnostics.consecutiveHeartbeatMisses > 0) {
    reasons.add('gateway_degraded');
  }

  if (options.diagnostics.consecutiveRpcFailures > 0) {
    reasons.add('rpc_timeout');
  }

  if (channelStatusFailureIsRecent) {
    reasons.add('channels_status_timeout');
  }

  return {
    state: reasons.has('gateway_unresponsive')
      ? 'unresponsive'
      : reasons.size > 0
        ? 'degraded'
        : 'healthy',
    reasons: [...reasons],
    consecutiveHeartbeatMisses: options.diagnostics.consecutiveHeartbeatMisses,
    lastAliveAt: options.diagnostics.lastAliveAt,
    lastRpcSuccessAt: options.diagnostics.lastRpcSuccessAt,
    lastRpcFailureAt: options.diagnostics.lastRpcFailureAt,
    lastRpcFailureMethod: options.diagnostics.lastRpcFailureMethod,
    lastChannelsStatusOkAt: options.lastChannelsStatusOkAt,
    lastChannelsStatusFailureAt: options.lastChannelsStatusFailureAt,
  };
}

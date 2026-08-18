export const GATEWAY_HEARTBEAT_INTERVAL_MS = 60_000;
export const GATEWAY_HEARTBEAT_TIMEOUT_MS = 30_000;
export const GATEWAY_HEARTBEAT_MAX_MISSES = 4;
export const GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 30_000] as const;

const HEARTBEAT_RECOVERY_DETECTION_BUDGET_MS = (
  GATEWAY_HEARTBEAT_INTERVAL_MS * GATEWAY_HEARTBEAT_MAX_MISSES
);
const MANAGED_GATEWAY_BOOTSTRAP_ALLOWANCE_MS = HEARTBEAT_RECOVERY_DETECTION_BUDGET_MS;
const GATEWAY_READY_PROBE_BUDGET_MS = GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS.reduce(
  (total, delay) => total + delay,
  0,
);

// Budget one heartbeat-detection window for recognizing the outage and an equal bounded
// allowance for managed-process bootstrap, then include the timeout and every ready probe.
// This intentionally does not mirror the much longer cold-start retry ceiling: retaining an
// IPC prompt for that entire ceiling would hide a dead run. Rounding up makes today's policy
// exactly 10 minutes and keeps it synchronized with heartbeat and ready-probe policy changes.
export const ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = 60_000 * Math.ceil((
  HEARTBEAT_RECOVERY_DETECTION_BUDGET_MS
  + MANAGED_GATEWAY_BOOTSTRAP_ALLOWANCE_MS
  + GATEWAY_HEARTBEAT_TIMEOUT_MS
  + GATEWAY_READY_PROBE_BUDGET_MS
) / 60_000
);

export const OPENCLAW_ACP_RECOVERY_GRACE_ENV = 'OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS';

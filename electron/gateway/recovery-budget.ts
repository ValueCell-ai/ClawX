export const GATEWAY_HEARTBEAT_INTERVAL_MS = 60_000;
export const GATEWAY_HEARTBEAT_TIMEOUT_MS = 30_000;
export const GATEWAY_HEARTBEAT_MAX_MISSES = 4;
export const GATEWAY_LIVENESS_DEADLINE_MS = 180_000;
export const GATEWAY_CONTROL_PROBE_TIMEOUT_MS = 5_000;
export const GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 30_000] as const;

const MANAGED_GATEWAY_BOOTSTRAP_ALLOWANCE_MS = GATEWAY_LIVENESS_DEADLINE_MS;
const GATEWAY_READY_PROBE_BUDGET_MS = GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS.reduce(
  (total, delay) => total + delay,
  0,
);

// Budget the liveness deadline, one bounded allowance for managed-process bootstrap,
// the deadline verification RPC, and every ready probe.
// This intentionally does not mirror the much longer cold-start retry ceiling: retaining an
// IPC prompt for that entire ceiling would hide a dead run. Rounding up keeps the grace
// synchronized with the deadline, verification, and ready-probe policy changes.
export const ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS = 60_000 * Math.ceil((
  GATEWAY_LIVENESS_DEADLINE_MS
  + MANAGED_GATEWAY_BOOTSTRAP_ALLOWANCE_MS
  + GATEWAY_CONTROL_PROBE_TIMEOUT_MS
  + GATEWAY_READY_PROBE_BUDGET_MS
) / 60_000
);

export const OPENCLAW_ACP_RECOVERY_GRACE_ENV = 'OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS';

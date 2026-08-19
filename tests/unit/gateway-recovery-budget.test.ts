// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS,
  GATEWAY_CONTROL_PROBE_TIMEOUT_MS,
  GATEWAY_HEARTBEAT_INTERVAL_MS,
  GATEWAY_HEARTBEAT_MAX_MISSES,
  GATEWAY_HEARTBEAT_TIMEOUT_MS,
  GATEWAY_LIVENESS_DEADLINE_MS,
  GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS,
  OPENCLAW_ACP_RECOVERY_GRACE_ENV,
} from '@electron/gateway/recovery-budget';

describe('managed Gateway recovery budget', () => {
  it('derives the accepted ACP prompt grace from deadline verification and ready probing', () => {
    const readyProbeMs = GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS.reduce((total, delay) => total + delay, 0);

    const rawRecoveryBudgetMs = (2 * GATEWAY_LIVENESS_DEADLINE_MS)
      + GATEWAY_CONTROL_PROBE_TIMEOUT_MS
      + readyProbeMs;

    expect(ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS).toBe(
      60_000 * Math.ceil(rawRecoveryBudgetMs / 60_000),
    );
    expect(ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS).toBe(480_000);
    expect(GATEWAY_LIVENESS_DEADLINE_MS).toBe(180_000);
    expect(GATEWAY_CONTROL_PROBE_TIMEOUT_MS).toBe(5_000);
    expect(GATEWAY_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(GATEWAY_HEARTBEAT_TIMEOUT_MS).toBe(30_000);
    expect(GATEWAY_HEARTBEAT_MAX_MISSES).toBe(4);
    expect(OPENCLAW_ACP_RECOVERY_GRACE_ENV).toBe('OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS');
  });
});

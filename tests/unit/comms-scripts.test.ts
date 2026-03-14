import { describe, expect, it } from 'vitest';

import {
  aggregateMetrics,
  calculateScenarioMetrics,
} from '../../scripts/comms/replay.mjs';
import { evaluateReport } from '../../scripts/comms/compare.mjs';

function buildPassingScenarioMetrics() {
  return {
    duplicate_event_rate: 0,
    event_fanout_ratio: 1,
    history_inflight_max: 1,
    history_load_qps: 0.3,
    rpc_p50_ms: 100,
    rpc_p95_ms: 150,
    rpc_timeout_rate: 0,
    gateway_reconnect_count: 0,
    message_loss_count: 0,
    message_order_violation_count: 0,
  };
}

describe('comms scripts', () => {
  it('computes scenario metrics with dedupe and inflight tracking', () => {
    const metrics = calculateScenarioMetrics([
      { ts: 0, type: 'gateway_event', runId: 'r1', sessionKey: 's1', seq: 1, state: 'started', fanout: 1 },
      { ts: 0.2, type: 'gateway_event', runId: 'r1', sessionKey: 's1', seq: 1, state: 'started', fanout: 1 },
      { ts: 0.5, type: 'history_load', sessionKey: 's1', action: 'start' },
      { ts: 0.7, type: 'history_load', sessionKey: 's1', action: 'end' },
      { ts: 1.0, type: 'rpc', latencyMs: 120, timeout: false },
      { ts: 1.5, type: 'message', lost: false, orderViolation: false },
    ]);

    expect(metrics.duplicate_event_rate).toBeCloseTo(0.5, 6);
    expect(metrics.history_inflight_max).toBe(1);
    expect(metrics.rpc_p95_ms).toBe(120);
  });

  it('aggregates multiple scenario metrics deterministically', () => {
    const aggregate = aggregateMetrics([
      { ...buildPassingScenarioMetrics(), rpc_p95_ms: 200 },
      { ...buildPassingScenarioMetrics(), rpc_p95_ms: 400 },
    ]);
    expect(aggregate.rpc_p95_ms).toBe(300);
    expect(aggregate.history_inflight_max).toBe(1);
  });

  it('fails report evaluation when required scenarios are missing', () => {
    const passing = buildPassingScenarioMetrics();
    const current = {
      aggregate: passing,
      scenarios: {
        'happy-path-chat': passing,
      },
    };
    const baseline = { aggregate: passing };
    const result = evaluateReport(current, baseline);

    expect(result.failures.some((f) => f.includes('missing scenario'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  classifyHistoryStartupRetryError,
  hasFatalStartupDiagnostic,
  shouldRetryStartupHistoryLoad,
  CHAT_HISTORY_STARTUP_RUNNING_WINDOW_MS,
} from '@/stores/chat/history-startup-retry';
import type { GatewayStartupDiagnosticSnapshot, GatewayStatus } from '@/types/gateway';

function status(partial: Partial<GatewayStatus>): GatewayStatus {
  return { state: 'running', port: 18789, ...partial };
}

function diag(code: GatewayStartupDiagnosticSnapshot['code'] = 'ACPX_VC_REDIST_MISSING'): GatewayStartupDiagnosticSnapshot {
  return {
    code,
    rawLine: 'raw',
    detail: 'detail',
    firstSeenAt: 1,
    lastSeenAt: 1,
    occurrences: 1,
  };
}

describe('classifyHistoryStartupRetryError', () => {
  it('classifies "unavailable during gateway startup" as gateway_startup', () => {
    expect(
      classifyHistoryStartupRetryError(
        new Error('chat.history unavailable during gateway startup'),
      ),
    ).toBe('gateway_startup');
  });

  it('classifies RPC timeout errors', () => {
    expect(
      classifyHistoryStartupRetryError(new Error('RPC timeout: chat.history')),
    ).toBe('timeout');
  });

  it('classifies gateway-unavailable transport errors', () => {
    expect(
      classifyHistoryStartupRetryError(new Error('Gateway not connected')),
    ).toBe('gateway_unavailable');
  });

  it('returns null for unrelated errors', () => {
    expect(classifyHistoryStartupRetryError(new Error('something else'))).toBeNull();
  });
});

describe('hasFatalStartupDiagnostic', () => {
  it('returns false when status is undefined or has no diagnostics', () => {
    expect(hasFatalStartupDiagnostic(undefined)).toBe(false);
    expect(hasFatalStartupDiagnostic(status({}))).toBe(false);
    expect(
      hasFatalStartupDiagnostic(status({ activeDiagnostics: [] })),
    ).toBe(false);
  });

  it('returns true when ACPX_VC_REDIST_MISSING is active', () => {
    expect(
      hasFatalStartupDiagnostic(status({ activeDiagnostics: [diag()] })),
    ).toBe(true);
  });
});

describe('shouldRetryStartupHistoryLoad', () => {
  it('bails out immediately when a fatal startup diagnostic is present', () => {
    const s = status({
      state: 'starting',
      activeDiagnostics: [diag('ACPX_VC_REDIST_MISSING')],
    });
    expect(shouldRetryStartupHistoryLoad(s, 'gateway_startup')).toBe(false);
    expect(shouldRetryStartupHistoryLoad(s, 'timeout')).toBe(false);
    expect(shouldRetryStartupHistoryLoad(s, 'gateway_unavailable')).toBe(false);
  });

  it('retries on gateway_startup while gateway is still initializing', () => {
    expect(
      shouldRetryStartupHistoryLoad(status({ state: 'starting' }), 'gateway_startup'),
    ).toBe(true);
  });

  it('retries on timeout when gateway is running but not yet beyond the grace window', () => {
    const s = status({ state: 'running', connectedAt: Date.now() - 1000 });
    expect(shouldRetryStartupHistoryLoad(s, 'timeout')).toBe(true);
  });

  it('stops retrying once gateway has been running past the startup grace window', () => {
    const s = status({
      state: 'running',
      connectedAt: Date.now() - (CHAT_HISTORY_STARTUP_RUNNING_WINDOW_MS + 1_000),
    });
    expect(shouldRetryStartupHistoryLoad(s, 'timeout')).toBe(false);
  });

  it('never retries when no error kind was classified', () => {
    expect(shouldRetryStartupHistoryLoad(status({}), null)).toBe(false);
  });
});

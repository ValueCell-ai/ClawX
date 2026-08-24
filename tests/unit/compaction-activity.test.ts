import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayCompactionActivity } from '@electron/gateway/compaction-activity';
import { GATEWAY_COMPACTION_RECOVERY_GRACE_MS } from '@electron/gateway/recovery-budget';

describe('GatewayCompactionActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks OpenClaw compaction diagnostics until the matching end signal', () => {
    const onChange = vi.fn();
    const activity = new GatewayCompactionActivity(onChange);

    activity.recordStderrLine('[compaction-diag] start session=agent:main:main');
    expect(activity.isActive()).toBe(true);

    activity.recordStderrLine('[compaction-diag] end session=agent:main:main');
    expect(activity.isActive()).toBe(false);
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });

  it('expires an unterminated compaction so recovery cannot remain deferred forever', async () => {
    const onChange = vi.fn();
    const activity = new GatewayCompactionActivity(onChange);

    activity.recordStderrLine('[compaction-diag] start session=agent:main:main');
    await vi.advanceTimersByTimeAsync(GATEWAY_COMPACTION_RECOVERY_GRACE_MS);

    expect(activity.isActive()).toBe(false);
    expect(onChange).toHaveBeenNthCalledWith(2, false);
  });
});

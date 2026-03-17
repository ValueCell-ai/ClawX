import { describe, expect, it } from 'vitest';
import {
  computeChannelRuntimeStatus,
  pickChannelRuntimeStatus,
} from '@/lib/channel-status';

describe('channel runtime status helpers', () => {
  it('treats healthy running channels as connected', () => {
    expect(
      computeChannelRuntimeStatus({
        running: true,
        connected: false,
        linked: false,
      }),
    ).toBe('connected');
  });

  it('treats successful probes as connected for forward compatibility', () => {
    expect(
      computeChannelRuntimeStatus({
        probe: { ok: true },
        running: false,
      }),
    ).toBe('connected');
  });

  it('returns error when runtime reports a lastError', () => {
    expect(
      computeChannelRuntimeStatus({
        running: true,
        lastError: 'bot token invalid',
      }),
    ).toBe('error');
  });

  it('returns disconnected for empty runtime state', () => {
    expect(computeChannelRuntimeStatus({})).toBe('disconnected');
  });

  it('keeps connected status when another account has an error', () => {
    expect(
      pickChannelRuntimeStatus([
        { connected: true },
        { lastError: 'boom' },
      ]),
    ).toBe('connected');
  });

  it('treats multi-account healthy running channels as connected', () => {
    expect(
      pickChannelRuntimeStatus([
        { running: true, connected: false },
        { running: true, connected: false },
      ]),
    ).toBe('connected');
  });

  it('uses summary-level errors when no account is connected', () => {
    expect(
      pickChannelRuntimeStatus(
        [{ accountId: 'default', connected: false, running: false }],
        { error: 'channel bootstrap failed' },
      ),
    ).toBe('error');
  });
});

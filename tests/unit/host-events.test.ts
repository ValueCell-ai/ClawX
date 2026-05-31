import { beforeEach, describe, expect, it, vi } from 'vitest';

const on = vi.fn();
const off = vi.fn();

beforeEach(() => {
  on.mockReset();
  off.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', {
    electron: { ipcRenderer: { on, off } },
  });
});

describe('hostEvents', () => {
  it('subscribes to gateway status over IPC', async () => {
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');
    const handler = vi.fn();

    hostEvents.onGatewayStatus(handler);

    expect(on).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));
  });

  it('does not create EventSource fallback', async () => {
    const eventSource = vi.fn();
    vi.stubGlobal('EventSource', eventSource);
    on.mockReturnValueOnce(() => undefined);
    const { hostEvents } = await import('@/lib/host-events');

    hostEvents.onGatewayNotification(vi.fn());

    expect(eventSource).not.toHaveBeenCalled();
  });
});

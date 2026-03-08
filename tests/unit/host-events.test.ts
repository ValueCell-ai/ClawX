import { beforeEach, describe, expect, it, vi } from 'vitest';

const addEventListenerMock = vi.fn();
const removeEventListenerMock = vi.fn();
const eventSourceMock = {
  addEventListener: addEventListenerMock,
  removeEventListener: removeEventListenerMock,
} as unknown as EventSource;

const createHostEventSourceMock = vi.fn(() => eventSourceMock);

vi.mock('@/lib/host-api', () => ({
  createHostEventSource: () => createHostEventSourceMock(),
}));

describe('host-events', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
  });

  it('subscribes through IPC for mapped host events', async () => {
    const onMock = vi.mocked(window.electron.ipcRenderer.on);
    const offMock = vi.mocked(window.electron.ipcRenderer.off);
    const captured: Array<(...args: unknown[]) => void> = [];
    onMock.mockImplementation((_, cb: (...args: unknown[]) => void) => {
      captured.push(cb);
      return () => {};
    });

    const { subscribeHostEvent } = await import('@/lib/host-events');
    const handler = vi.fn();
    const unsubscribe = subscribeHostEvent('gateway:status', handler);

    expect(onMock).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));
    expect(createHostEventSourceMock).not.toHaveBeenCalled();

    captured[0]({ state: 'running' });
    expect(handler).toHaveBeenCalledWith({ state: 'running' });

    unsubscribe();
    expect(offMock).toHaveBeenCalledWith('gateway:status-changed', expect.any(Function));
  });

  it('does not use SSE fallback by default for unknown events', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { subscribeHostEvent } = await import('@/lib/host-events');
    const unsubscribe = subscribeHostEvent('unknown:event', vi.fn());
    expect(createHostEventSourceMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[host-events] no IPC mapping for event "unknown:event", SSE fallback disabled',
    );
    unsubscribe();
    warnSpy.mockRestore();
  });

  it('uses SSE fallback only when explicitly enabled', async () => {
    window.localStorage.setItem('clawx:allow-sse-fallback', '1');
    const { subscribeHostEvent } = await import('@/lib/host-events');
    const handler = vi.fn();
    const unsubscribe = subscribeHostEvent('unknown:event', handler);

    expect(createHostEventSourceMock).toHaveBeenCalledTimes(1);
    expect(addEventListenerMock).toHaveBeenCalledWith('unknown:event', expect.any(Function));

    const listener = addEventListenerMock.mock.calls[0][1] as (event: Event) => void;
    listener({ data: JSON.stringify({ x: 1 }) } as unknown as Event);
    expect(handler).toHaveBeenCalledWith({ x: 1 });

    unsubscribe();
    expect(removeEventListenerMock).toHaveBeenCalledWith('unknown:event', expect.any(Function));
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadGatewayReloadPolicy } = vi.hoisted(() => ({
  mockLoadGatewayReloadPolicy: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/gateway/reload-policy', async () => {
  const actual = await vi.importActual<typeof import('@electron/gateway/reload-policy')>(
    '@electron/gateway/reload-policy',
  );
  return {
    ...actual,
    loadGatewayReloadPolicy: (...args: unknown[]) => mockLoadGatewayReloadPolicy(...args),
  };
});

describe('GatewayManager refreshReloadPolicy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T00:00:00.000Z'));
  });

  it('deduplicates concurrent refresh calls', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    let resolveLoad: ((value: { mode: 'reload'; debounceMs: number }) => void) | null = null;
    mockLoadGatewayReloadPolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    const p1 = refresh(true);
    const p2 = refresh(true);

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    resolveLoad?.({ mode: 'reload', debounceMs: 1300 });
    await Promise.all([p1, p2]);

    expect((manager as unknown as { reloadPolicy: { mode: string; debounceMs: number } }).reloadPolicy).toEqual({
      mode: 'reload',
      debounceMs: 1300,
    });
  });

  it('hits TTL cache and skips refresh within window', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    mockLoadGatewayReloadPolicy.mockResolvedValueOnce({ mode: 'restart', debounceMs: 2200 });

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    await refresh();
    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-03-15T00:00:10.000Z'));
    await refresh();

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);
  });

  it('refreshes immediately when force=true even within TTL', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    mockLoadGatewayReloadPolicy
      .mockResolvedValueOnce({ mode: 'hybrid', debounceMs: 1200 })
      .mockResolvedValueOnce({ mode: 'off', debounceMs: 9000 });

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    await refresh();
    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-03-15T00:00:05.000Z'));
    await refresh(true);

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(2);
    expect((manager as unknown as { reloadPolicy: { mode: string; debounceMs: number } }).reloadPolicy).toEqual({
      mode: 'off',
      debounceMs: 9000,
    });
  });
});

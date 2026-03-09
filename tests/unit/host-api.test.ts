import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('host-api', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses IPC proxy and returns unified envelope json', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true },
      },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ success: boolean }>('/api/settings');

    expect(result.success).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({ path: '/api/settings', method: 'GET' }),
    );
  });

  it('supports legacy proxy envelope response', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      status: 200,
      ok: true,
      json: { ok: 1 },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ ok: number }>('/api/settings');
    expect(result.ok).toBe(1);
  });

  it('falls back to browser fetch when hostapi handler is not registered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    invokeIpcMock.mockResolvedValueOnce({
      ok: false,
      error: { message: 'No handler registered for hostapi:fetch' },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ fallback: boolean }>('/api/test');

    expect(result.fallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/test',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('throws message from legacy non-ok envelope', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      ok: false,
      status: 401,
      json: { error: 'Invalid Authentication' },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    await expect(hostApiFetch('/api/test')).rejects.toThrow('Invalid Authentication');
  });

  it('falls back to browser fetch only when IPC channel is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    invokeIpcMock.mockRejectedValueOnce(new Error('Invalid IPC channel: hostapi:fetch'));

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ fallback: boolean }>('/api/test');

    expect(result.fallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/test',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});

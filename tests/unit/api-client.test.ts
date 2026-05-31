import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invokeIpc,
  invokeIpcWithRetry,
  AppError,
  toUserMessage,
} from '@/lib/api-client';

describe('api-client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('forwards invoke arguments and returns result', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ ok: true, data: { ok: true } });

    const result = await invokeIpc<{ ok: boolean }>('settings:getAll', { a: 1 });

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'app:request',
      expect.objectContaining({
        module: 'settings',
        action: 'getAll',
      }),
    );
  });

  it('normalizes timeout errors', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockRejectedValueOnce(new Error('Gateway Timeout'));

    await expect(invokeIpc('gateway:status')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('retries once for retryable errors', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'TIMEOUT', message: 'network timeout' } })
      .mockResolvedValueOnce({ ok: true, data: { success: true } });

    const result = await invokeIpcWithRetry<{ success: boolean }>('provider:list', [], 1);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('returns user-facing message for permission error', () => {
    const msg = toUserMessage(new AppError('PERMISSION', 'forbidden'));
    expect(msg).toContain('Permission denied');
  });

  it('returns user-facing message for auth invalid error', () => {
    const msg = toUserMessage(new AppError('AUTH_INVALID', 'Invalid Authentication'));
    expect(msg).toContain('Authentication failed');
  });

  it('returns user-facing message for channel unavailable error', () => {
    const msg = toUserMessage(new AppError('CHANNEL_UNAVAILABLE', 'Invalid IPC channel'));
    expect(msg).toContain('Service channel unavailable');
  });

  it('falls back to legacy channel when unified route is unsupported', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke
      .mockRejectedValueOnce(new Error('APP_REQUEST_UNSUPPORTED:settings.getAll'))
      .mockResolvedValueOnce({ foo: 'bar' });

    const result = await invokeIpc<{ foo: string }>('settings:getAll');
    expect(result.foo).toBe('bar');
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings:getAll');
  });

  it('sends tuple payload for multi-arg unified requests', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ ok: true, data: { success: true } });

    const result = await invokeIpc<{ success: boolean }>('settings:set', 'language', 'en');

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      'app:request',
      expect.objectContaining({
        module: 'settings',
        action: 'set',
        payload: ['language', 'en'],
      }),
    );
  });

  it('uses ipc for gateway rpc', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ success: true, result: { ok: true } });

    await expect(invokeIpc('gateway:rpc', 'chat.history', {}))
      .resolves.toEqual({ success: true, result: { ok: true } });
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', {});
  });
});

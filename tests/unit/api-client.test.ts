import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invokeIpc,
  invokeIpcWithRetry,
  AppError,
  toUserMessage,
  configureApiClient,
  registerTransportInvoker,
  unregisterTransportInvoker,
  clearTransportBackoff,
  getApiClientConfig,
  applyGatewayTransportPreference,
  createGatewayHttpTransportInvoker,
  getGatewayWsDiagnosticEnabled,
  setGatewayWsDiagnosticEnabled,
} from '@/lib/api-client';

describe('api-client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.removeItem('clawx:gateway-ws-diagnostic');
    configureApiClient({
      enabled: { ws: false, http: false },
      rules: [{ matcher: /.*/, order: ['ipc'] }],
    });
    clearTransportBackoff();
    unregisterTransportInvoker('ws');
    unregisterTransportInvoker('http');
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

  it('falls through ws/http and succeeds via ipc when advanced transports fail', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({ ok: true, data: { ok: true } });

    registerTransportInvoker('ws', async () => {
      throw new Error('ws unavailable');
    });
    registerTransportInvoker('http', async () => {
      throw new Error('http unavailable');
    });
    configureApiClient({
      enabled: { ws: true, http: true },
      rules: [{ matcher: 'gateway:rpc', order: ['ws', 'http', 'ipc'] }],
    });

    const result = await invokeIpc<{ ok: boolean }>('gateway:rpc', 'chat.history', {});
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('gateway:rpc', 'chat.history', {});
  });

  it('backs off failed ws transport and skips it on immediate retry', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValue({ ok: true });
    const wsInvoker = vi.fn(async () => {
      throw new Error('ws unavailable');
    });

    registerTransportInvoker('ws', wsInvoker);
    configureApiClient({
      enabled: { ws: true, http: false },
      rules: [{ matcher: 'gateway:rpc', order: ['ws', 'ipc'] }],
    });

    await invokeIpc('gateway:rpc', 'chat.history', {});
    await invokeIpc('gateway:rpc', 'chat.history', {});

    expect(wsInvoker).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('retries ws transport after backoff is cleared', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValue({ ok: true });
    const wsInvoker = vi.fn(async () => {
      throw new Error('ws unavailable');
    });

    registerTransportInvoker('ws', wsInvoker);
    configureApiClient({
      enabled: { ws: true, http: false },
      rules: [{ matcher: 'gateway:rpc', order: ['ws', 'ipc'] }],
    });

    await invokeIpc('gateway:rpc', 'chat.history', {});
    clearTransportBackoff('ws');
    await invokeIpc('gateway:rpc', 'chat.history', {});

    expect(wsInvoker).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('defaults transport preference to ipc-only', () => {
    applyGatewayTransportPreference();
    const config = getApiClientConfig();
    expect(config.enabled.ws).toBe(false);
    expect(config.enabled.http).toBe(false);
    expect(config.rules[0]).toEqual({ matcher: /^gateway:rpc$/, order: ['ipc'] });
  });

  it('enables ws->http->ipc order when ws diagnostic is on', () => {
    setGatewayWsDiagnosticEnabled(true);
    expect(getGatewayWsDiagnosticEnabled()).toBe(true);

    const config = getApiClientConfig();
    expect(config.enabled.ws).toBe(true);
    expect(config.enabled.http).toBe(true);
    expect(config.rules[0]).toEqual({ matcher: /^gateway:rpc$/, order: ['ws', 'http', 'ipc'] });
  });

  it('parses gateway:httpProxy unified envelope response', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { type: 'res', ok: true, payload: { rows: [1, 2] } },
      },
    });

    const invoker = createGatewayHttpTransportInvoker();
    const result = await invoker<{ success: boolean; result: { rows: number[] } }>(
      'gateway:rpc',
      ['chat.history', { sessionKey: 's1' }],
    );

    expect(result.success).toBe(true);
    expect(result.result.rows).toEqual([1, 2]);
    expect(invoke).toHaveBeenCalledWith(
      'gateway:httpProxy',
      expect.objectContaining({
        path: '/rpc',
        method: 'POST',
      }),
    );
  });

  it('throws meaningful error when gateway:httpProxy unified envelope fails', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: false,
      error: { message: 'proxy unavailable' },
    });

    const invoker = createGatewayHttpTransportInvoker();
    await expect(invoker('gateway:rpc', ['chat.history', {}])).rejects.toThrow('proxy unavailable');
  });

  it('normalizes raw gateway:httpProxy payload into ipc-style envelope', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { channels: [{ id: 'telegram-default' }] },
      },
    });

    const invoker = createGatewayHttpTransportInvoker();
    const result = await invoker<{ success: boolean; result: { channels: Array<{ id: string }> } }>(
      'gateway:rpc',
      ['channels.status', { probe: false }],
    );

    expect(result.success).toBe(true);
    expect(result.result.channels[0].id).toBe('telegram-default');
  });

  it('rejects invalid config.patch params before gateway:httpProxy call', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    const invoker = createGatewayHttpTransportInvoker();

    await expect(invoker('gateway:rpc', ['config.patch', 'abc'])).rejects.toThrow(
      'gateway:rpc config.patch requires object params',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects invalid config.patch.patch before gateway:httpProxy call', async () => {
    const invoke = vi.mocked(window.electron.ipcRenderer.invoke);
    const invoker = createGatewayHttpTransportInvoker();

    await expect(invoker('gateway:rpc', ['config.patch', { patch: 'abc' }])).rejects.toThrow(
      'gateway:rpc config.patch requires object patch',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

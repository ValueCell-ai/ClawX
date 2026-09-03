import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsrConfig } from '@shared/host-api/contract';
import { parseAsrErrorCode } from '@shared/asr/errors';

const { deleteProviderSecretMock, getProviderSecretMock, setProviderSecretMock } = vi.hoisted(() => ({
  deleteProviderSecretMock: vi.fn(),
  getProviderSecretMock: vi.fn(),
  setProviderSecretMock: vi.fn(),
}));

const { AsrMockStore, asrMockStoreInstances } = vi.hoisted(() => {
  const instances: Array<{ get(key: string): unknown }> = [];
  class AsrMockStore {
    private data: Record<string, unknown>;

    constructor(options: { defaults?: Record<string, unknown> } = {}) {
      this.data = { ...(options.defaults ?? {}) };
      instances.push(this);
    }

    get(key: string): unknown {
      return this.data[key];
    }

    set(key: string, value: unknown): void {
      this.data[key] = value;
    }
  }
  return { AsrMockStore: AsrMockStore, asrMockStoreInstances: instances };
});

vi.mock('electron-store', () => ({ default: AsrMockStore }));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: (...args: unknown[]) => getProviderSecretMock(...args),
  setProviderSecret: (...args: unknown[]) => setProviderSecretMock(...args),
  deleteProviderSecret: (...args: unknown[]) => deleteProviderSecretMock(...args),
}));

const validConfig: AsrConfig = {
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'whisper-1',
};

describe('asr host api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getProviderSecretMock.mockResolvedValue(null);
    setProviderSecretMock.mockResolvedValue(undefined);
    deleteProviderSecretMock.mockResolvedValue(undefined);
  });

  const loadApi = async () => {
    const { createAsrApi } = await import('@electron/services/asr-api');
    return createAsrApi();
  };

  it('reports unconfigured readiness when nothing is stored', async () => {
    const api = await loadApi();
    await expect(api.getConfig()).resolves.toEqual({
      config: null,
      hasApiKey: false,
      configured: false,
    });
  });

  it('persists a validated config and reports configured only once the key exists', async () => {
    const api = await loadApi();

    await expect(api.saveConfig({ config: validConfig })).resolves.toEqual({
      config: validConfig,
      hasApiKey: false,
      configured: false,
    });

    const store = asrMockStoreInstances.at(-1);
    expect(store?.get('asrConfig')).toEqual(validConfig);

    getProviderSecretMock.mockResolvedValue({ type: 'api_key', accountId: 'asr', apiKey: 'sk-test' });
    await expect(api.getConfig()).resolves.toEqual({
      config: validConfig,
      hasApiKey: true,
      configured: true,
    });
  });

  it('rejects invalid config payloads without touching the store', async () => {
    const api = await loadApi();
    await api.getConfig();
    const store = asrMockStoreInstances.at(-1);
    expect(store?.get('asrConfig')).toBeNull();

    await expect(api.saveConfig({ config: { ...validConfig, baseUrl: 'ftp://example.com/v1' } }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.saveConfig({ config: { ...validConfig, model: '' } }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.saveConfig(null as never))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(store?.get('asrConfig')).toBeNull();
    expect(asrMockStoreInstances.at(-1)).toBe(store);
  });

  it('throws INVALID_INPUT for malformed transcribe payloads', async () => {
    const api = await loadApi();

    await expect(api.transcribe(undefined as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.transcribe({} as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api.transcribe({ wav: new Uint8Array(10) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws NOT_CONFIGURED when transcribing without a saved key', async () => {
    const api = await loadApi();
    await api.saveConfig({ config: validConfig });

    await expect(api.transcribe({ wav: new Uint8Array(44) })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('serializes AUTH failures from the client into the ASR message prefix', async () => {
    const api = await loadApi();
    getProviderSecretMock.mockResolvedValue({ type: 'api_key', accountId: 'asr', apiKey: 'sk-test' });
    await api.saveConfig({ config: validConfig });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(api.transcribe({ wav: new Uint8Array(44) })).rejects.toMatchObject({
        code: 'AUTH',
        message: expect.stringMatching(/^ASR:AUTH:/),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses ASR error codes from serialized messages', () => {
    expect(parseAsrErrorCode('ASR:RATE_LIMITED:slow down')).toBe('RATE_LIMITED');
    expect(parseAsrErrorCode('nope')).toBeNull();
  });

  it('stores trimmed API keys and clears the key on an empty string', async () => {
    const api = await loadApi();

    await api.saveConfig({ config: validConfig, apiKey: '  sk-live  ' });
    expect(setProviderSecretMock).toHaveBeenCalledWith({
      type: 'api_key',
      accountId: 'asr',
      apiKey: 'sk-live',
    });
    expect(deleteProviderSecretMock).not.toHaveBeenCalled();

    await api.saveConfig({ config: validConfig, apiKey: '' });
    expect(deleteProviderSecretMock).toHaveBeenCalledWith('asr');

    await api.saveConfig({ config: validConfig });
    expect(deleteProviderSecretMock).toHaveBeenCalledTimes(1);
  });
});

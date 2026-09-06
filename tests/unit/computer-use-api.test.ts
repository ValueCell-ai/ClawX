// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: false,
  config: {} as Record<string, unknown>,
  install: vi.fn(async () => ({ success: true })),
  mutate: vi.fn(),
}));
vi.mock('@electron/utils/store', () => ({
  getSetting: async () => mocks.enabled,
  saveComputerUseEnabled: async (value: boolean) => { mocks.enabled = value; },
}));
vi.mock('@electron/utils/plugin-install', () => ({ ensureClawXCuaPluginInstalled: mocks.install }));
vi.mock('@electron/gateway/config-delivery', () => ({ mutateOpenClawConfig: mocks.mutate }));
import { createComputerUseApi } from '@electron/services/computer-use-api';

function harness() {
  const runtime = {
    start: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    refreshPermissions: vi.fn(async () => true),
    requestPermissions: vi.fn(async () => undefined),
    getStatus: vi.fn(() => ({ supported: true, running: false, permissions: { accessibility: false, screenRecording: 'denied' } })),
  };
  return { runtime, api: createComputerUseApi(runtime as never) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  mocks.config = {};
  mocks.mutate.mockImplementation(async (fn) => { await fn(mocks.config); return true; });
});

describe('Computer Use management', () => {
  it('returns unchanged permissions after an explicit request and never re-prompts on status or refresh', async () => {
    mocks.enabled = true;
    const { api, runtime } = harness();
    runtime.start.mockResolvedValue(false);
    const before = await api.status();
    expect(await api.requestPermissions()).toEqual(before);
    await api.status();
    await api.refresh();
    expect(runtime.requestPermissions).toHaveBeenCalledOnce();
    expect((await api.status()).permissions?.screenRecording).toBe('denied');
  });

  it('reports disabled status without runtime side effects and rejects permission requests', async () => {
    const { api, runtime } = harness();
    expect((await api.status()).enabled).toBe(false);
    await expect(api.requestPermissions()).rejects.toThrow('disabled');
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.requestPermissions).not.toHaveBeenCalled();
  });

  it('persists opt-in, installs and starts without permission requests, then disables policy', async () => {
    const { api, runtime } = harness();
    expect((await api.setEnabled({ enabled: true })).enabled).toBe(true);
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.config).toMatchObject({ plugins: { entries: { 'clawx-cua-computer': { enabled: true } } } });
    await api.setEnabled({ enabled: false });
    expect(mocks.enabled).toBe(false);
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(mocks.config).toMatchObject({ plugins: { entries: { 'clawx-cua-computer': { enabled: false } } } });
    expect(mocks.config.plugins).not.toHaveProperty('allow');
  });

  it.each([
    { allow: undefined },
    { allow: [] },
    { allow: ['clawx-cua-computer'] },
    { allow: ['provider-plugin'] },
  ])(
    'preserves allowlist semantics for live toggles with $allow', async ({ allow }) => {
      const { api } = harness();
      mocks.config = { plugins: {
        ...(allow === undefined ? {} : { allow: [...allow] }),
        entries: { 'provider-plugin': { enabled: true } },
      } };
      await api.setEnabled({ enabled: false });
      expect((mocks.config.plugins as Record<string, unknown>).allow).toEqual(allow);
      for (const enabled of [true, false, true, false]) {
        await api.setEnabled({ enabled });
        const plugins = mocks.config.plugins as Record<string, unknown>;
        expect(plugins.allow).toEqual(allow?.length ? [...new Set([...allow, 'clawx-cua-computer'])] : allow);
        expect(Object.hasOwn(plugins, 'allow')).toBe(allow !== undefined);
        expect(plugins.entries).toEqual({
          'provider-plugin': { enabled: true },
          'clawx-cua-computer': { enabled },
        });
      }
    },
  );

  it('serializes activation and disable behind an in-flight start', async () => {
    const { api, runtime } = harness();
    let release!: () => void;
    runtime.start.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = () => resolve(true); }));
    const enable = api.setEnabled({ enabled: true });
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce());
    const disable = api.setEnabled({ enabled: false });
    const activation = api.refresh();
    release();
    await Promise.all([enable, disable, activation]);
    expect(mocks.enabled).toBe(false);
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.refreshPermissions).not.toHaveBeenCalled();
  });

  it('keeps disabled persistence and policy even if stopping fails', async () => {
    const { api, runtime } = harness();
    mocks.enabled = true;
    runtime.stop.mockRejectedValueOnce(new Error('stop failed'));
    await expect(api.setEnabled({ enabled: false })).rejects.toThrow('stop failed');
    expect(mocks.enabled).toBe(false);
    expect(mocks.config).toMatchObject({ plugins: { entries: { 'clawx-cua-computer': { enabled: false } } } });
  });

  it('starts a persisted opt-in without requesting permissions and does nothing privileged on default-off startup', async () => {
    const { api, runtime } = harness();
    await api.initialize();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
    mocks.enabled = true;
    await api.initialize();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.requestPermissions).not.toHaveBeenCalled();
  });

  it('rolls back a failed enable and can retry after a policy error', async () => {
    const { api, runtime } = harness();
    mocks.mutate.mockRejectedValueOnce(new Error('Gateway config failed'));
    await expect(api.setEnabled({ enabled: true })).rejects.toThrow('Gateway config failed');
    expect(mocks.enabled).toBe(false);
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(mocks.config).toMatchObject({ plugins: { entries: { 'clawx-cua-computer': { enabled: false } } } });
    await expect(api.setEnabled({ enabled: true })).resolves.toMatchObject({ enabled: true });
  });

  it('blocks queued activation and enabling once quit begins', async () => {
    const { api, runtime } = harness();
    mocks.enabled = true;
    const stop = api.stop();
    await api.refresh();
    await expect(api.setEnabled({ enabled: true })).rejects.toThrow('shutting down');
    await stop;
    expect(runtime.refreshPermissions).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it('rejects malformed and unsupported enable requests', async () => {
    const { api, runtime } = harness();
    await expect(api.setEnabled({ enabled: 'true' } as never)).rejects.toThrow();
    runtime.getStatus.mockReturnValue({ supported: false, running: false, permissions: { accessibility: false, screenRecording: 'denied' } });
    await expect(api.setEnabled({ enabled: true })).rejects.toThrow('unsupported');
    expect(mocks.enabled).toBe(false);
  });
});

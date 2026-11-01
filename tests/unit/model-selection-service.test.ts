// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), accounts: vi.fn(), setDefault: vi.fn(), write: vi.fn(), snapshot: vi.fn() }));
vi.mock('@electron/services/providers/provider-service', () => ({ getProviderService: () => ({ getAccount: mocks.account, listAccounts: mocks.accounts, setDefaultAccount: mocks.setDefault }) }));
vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  getOpenClawProviderKey: (type: string, id: string) => type === 'custom' ? id : type,
  syncDefaultProviderToRuntime: mocks.write,
}));
vi.mock('@electron/utils/agent-config', () => ({ listAgentsSnapshot: mocks.snapshot }));
import { createTaskModelSelection, setGlobalDefaultModel } from '@electron/services/model-selection-service';
import type { GatewayManager } from '@electron/gateway/manager';

const account = { id: 'custom-work', vendorId: 'custom', label: 'Work', enabled: true, metadata: { customModels: ['model-a', 'provider/model-b'] } };
const ref = 'custom-work/provider/model-b';
describe('model selection ownership in Main', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue(structuredClone(account));
    mocks.accounts.mockResolvedValue([structuredClone(account)]);
    mocks.snapshot.mockResolvedValue({ defaultModelRef: ref });
  });
  it('sets a specific imported model and verifies runtime before saving the account preference', async () => {
    await expect(setGlobalDefaultModel({ accountId: account.id, modelId: 'provider/model-b' })).resolves.toEqual({ success: true, modelRef: ref });
    expect(mocks.write).toHaveBeenCalledWith('custom-work', undefined, 'provider/model-b');
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.snapshot.mock.invocationCallOrder[0]);
    expect(mocks.snapshot.mock.invocationCallOrder[0]).toBeLessThan(mocks.setDefault.mock.invocationCallOrder[0]);
    expect(await mocks.account()).toEqual(account);
  });
  it('never reports success or changes the account preference when runtime did not change', async () => {
    mocks.snapshot.mockResolvedValue({ defaultModelRef: 'old/model' });
    expect((await setGlobalDefaultModel({ accountId: account.id, modelId: 'provider/model-b' })).success).toBe(false);
    expect(mocks.setDefault).not.toHaveBeenCalled();
  });
  it('rejects unknown models before writing global configuration', async () => {
    expect((await setGlobalDefaultModel({ accountId: account.id, modelId: 'unknown' })).success).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('reads exactly the requested task from Gateway without mutating or creating it', async () => {
    const rpc = vi.fn().mockResolvedValue({ sessions: [{ key: 'agent:main:other', model: 'wrong', modelProvider: 'custom-work' }, { key: 'agent:main:task', model: 'provider/model-b', modelProvider: 'custom-work' }] });
    const api = createTaskModelSelection({ rpc } as unknown as GatewayManager);
    await expect(api.getSessionModel({ sessionKey: 'agent:main:task' })).resolves.toEqual({ success: true, modelRef: ref });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('sessions.list', expect.objectContaining({ search: 'agent:main:task' }));
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('persists only a task override and preserves slashes in the model ID', async () => {
    const rpc = vi.fn().mockResolvedValue({ key: 'agent:main:task', resolved: { modelProvider: 'custom-work', model: 'provider/model-b' } });
    const api = createTaskModelSelection({ rpc } as unknown as GatewayManager);
    await expect(api.setSessionModel({ sessionKey: 'agent:main:task', modelRef: ref })).resolves.toEqual({ success: true, modelRef: ref });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('sessions.patch', { key: 'agent:main:task', model: ref });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.setDefault).not.toHaveBeenCalled();
  });
  it('rejects invalid keys, unknown models and unconfirmed task writes', async () => {
    const rpc = vi.fn().mockResolvedValue({ resolved: { modelProvider: 'other', model: 'wrong' } });
    const api = createTaskModelSelection({ rpc } as unknown as GatewayManager);
    expect((await api.setSessionModel({ sessionKey: '../other', modelRef: ref })).success).toBe(false);
    expect((await api.setSessionModel({ sessionKey: 'agent:main:task', modelRef: 'unknown/model' })).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect((await api.setSessionModel({ sessionKey: 'agent:main:task', modelRef: ref })).success).toBe(false);
  });
});

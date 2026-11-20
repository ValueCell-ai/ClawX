// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ account: vi.fn(), setDefault: vi.fn(), write: vi.fn(), snapshot: vi.fn() }));
vi.mock('@electron/services/providers/provider-service', () => ({ getProviderService: () => ({ getAccount: mocks.account, setDefaultAccount: mocks.setDefault }) }));
vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  getOpenClawProviderKey: (type: string, id: string) => type === 'custom' ? id : type,
  syncDefaultProviderToRuntime: mocks.write,
}));
vi.mock('@electron/utils/agent-config', () => ({ listAgentsSnapshot: mocks.snapshot }));
import { setGlobalDefaultModel } from '@electron/services/model-selection-service';

const account = { id: 'custom-work', vendorId: 'custom', label: 'Work', enabled: true, metadata: { customModels: ['model-a', 'provider/model-b'] } };
const ref = 'custom-work/provider/model-b';
describe('model selection ownership in Main', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.account.mockResolvedValue(structuredClone(account));
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(),
  listProviderAccounts: vi.fn(),
  deleteProviderAccount: vi.fn(),
  saveProviderAccount: vi.fn(),
  getActiveOpenClawProviders: vi.fn(),
  getOpenClawProvidersConfig: vi.fn(),
  getOpenClawProviderKeyForType: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mocks.ensureProviderStoreMigrated,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: mocks.listProviderAccounts,
  deleteProviderAccount: mocks.deleteProviderAccount,
  getProviderAccount: vi.fn(),
  getDefaultProviderAccountId: vi.fn(),
  providerAccountToConfig: vi.fn(),
  providerConfigToAccount: vi.fn(),
  saveProviderAccount: mocks.saveProviderAccount,
  setDefaultProviderAccount: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getActiveOpenClawProviders: mocks.getActiveOpenClawProviders,
  getOpenClawProvidersConfig: mocks.getOpenClawProvidersConfig,
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: mocks.getOpenClawProviderKeyForType,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  deleteApiKey: vi.fn(),
  deleteProvider: vi.fn(),
  getApiKey: vi.fn(),
  hasApiKey: vi.fn(),
  saveProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
  storeApiKey: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

vi.mock('@electron/shared/providers/registry', () => ({
  PROVIDER_DEFINITIONS: [],
  getProviderDefinition: vi.fn(),
}));

import { ProviderService } from '@electron/services/providers/provider-service';
import type { ProviderAccount } from '@electron/shared/providers/types';

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'test-account',
    vendorId: 'moonshot' as ProviderAccount['vendorId'],
    label: 'Test',
    authMode: 'api_key' as ProviderAccount['authMode'],
    enabled: true,
    isDefault: false,
    createdAt: '2026-03-19T00:00:00.000Z',
    updatedAt: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProviderService.listAccounts stale-account cleanup', () => {
  let service: ProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProviderStoreMigrated.mockResolvedValue(undefined);
    mocks.getOpenClawProviderKeyForType.mockImplementation(
      (type: string, id: string) => `${type}/${id}`,
    );
    mocks.getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: undefined });
    service = new ProviderService();
  });

  it('preserves all accounts when activeProviders is empty (config missing/unreadable)', async () => {
    const accounts = [
      makeAccount({ id: 'custom-1', vendorId: 'custom' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'moonshot-1', vendorId: 'moonshot' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'anthropic-1', vendorId: 'anthropic' as ProviderAccount['vendorId'] }),
    ];
    mocks.listProviderAccounts.mockResolvedValue(accounts);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set<string>());

    const result = await service.listAccounts();

    // All accounts should be preserved — none deleted
    expect(result).toEqual(accounts);
    expect(mocks.deleteProviderAccount).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('skipping stale-account cleanup'),
    );
  });

  it('removes stale non-builtin accounts when config has active providers', async () => {
    const accounts = [
      makeAccount({ id: 'moonshot-1', vendorId: 'moonshot' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'custom-stale', vendorId: 'custom' as ProviderAccount['vendorId'] }),
    ];
    mocks.listProviderAccounts.mockResolvedValue(accounts);
    // Only moonshot is active in config
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['moonshot']));

    const result = await service.listAccounts();

    // custom-stale should be deleted (non-builtin, not active)
    expect(mocks.deleteProviderAccount).toHaveBeenCalledWith('custom-stale');
    expect(mocks.deleteProviderAccount).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('moonshot-1');
  });

  it('never removes builtin provider accounts even if not in activeProviders', async () => {
    const accounts = [
      makeAccount({ id: 'anthropic-1', vendorId: 'anthropic' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'openai-1', vendorId: 'openai' as ProviderAccount['vendorId'] }),
    ];
    mocks.listProviderAccounts.mockResolvedValue(accounts);
    // Config has some providers, but NOT anthropic or openai explicitly
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['moonshot']));

    const result = await service.listAccounts();

    // Builtin accounts should be preserved regardless
    expect(mocks.deleteProviderAccount).not.toHaveBeenCalled();
    expect(result).toEqual(accounts);
  });

  it('returns empty when no accounts and no active OpenClaw providers', async () => {
    mocks.listProviderAccounts.mockResolvedValue([]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set());

    const result = await service.listAccounts();

    expect(result).toEqual([]);
    expect(mocks.getActiveOpenClawProviders).toHaveBeenCalled();
    expect(mocks.deleteProviderAccount).not.toHaveBeenCalled();
  });

  it('matches accounts by vendorId, id, or openClawKey', async () => {
    const accounts = [
      makeAccount({ id: 'custom-abc', vendorId: 'custom' as ProviderAccount['vendorId'] }),
    ];
    mocks.listProviderAccounts.mockResolvedValue(accounts);
    // The openClawKey matches
    mocks.getOpenClawProviderKeyForType.mockReturnValue('custom/custom-abc');
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['custom/custom-abc']));

    const result = await service.listAccounts();

    expect(mocks.deleteProviderAccount).not.toHaveBeenCalled();
    expect(result).toEqual(accounts);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(),
  listProviderAccounts: vi.fn(),
  deleteProviderAccount: vi.fn(),
  saveProviderAccount: vi.fn(),
  getActiveOpenClawProviders: vi.fn(),
  getOpenClawProvidersConfig: vi.fn(),
  getOpenClawProviderKeyForType: vi.fn(),
  getAliasSourceTypes: vi.fn(),
  getProviderDefinition: vi.fn(),
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
  getAliasSourceTypes: mocks.getAliasSourceTypes,
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
  getProviderDefinition: mocks.getProviderDefinition,
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

/**
 * Default mock: getOpenClawProviderKeyForType maps type to itself,
 * except minimax-portal-cn → minimax-portal (alias).
 */
function setupDefaultKeyMapping() {
  mocks.getOpenClawProviderKeyForType.mockImplementation(
    (type: string) => type === 'minimax-portal-cn' ? 'minimax-portal' : type,
  );
}

describe('ProviderService.listAccounts (openclaw.json as sole source of truth)', () => {
  let service: ProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProviderStoreMigrated.mockResolvedValue(undefined);
    setupDefaultKeyMapping();
    mocks.getAliasSourceTypes.mockReturnValue([]);
    mocks.getProviderDefinition.mockReturnValue(undefined);
    mocks.getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: undefined });
    mocks.listProviderAccounts.mockResolvedValue([]);
    service = new ProviderService();
  });

  it('returns empty when activeProviders is empty', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'moonshot-1', vendorId: 'moonshot' as ProviderAccount['vendorId'] }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set<string>());

    const result = await service.listAccounts();

    expect(result).toEqual([]);
  });

  it('returns only providers present in openclaw.json, ignoring extra store accounts', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'moonshot-1', vendorId: 'moonshot' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'custom-orphan', vendorId: 'custom' as ProviderAccount['vendorId'] }),
    ]);
    // Only moonshot is active — custom is NOT in openclaw.json
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['moonshot']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { moonshot: { baseUrl: 'https://api.moonshot.cn/v1' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('moonshot-1');
  });

  it('seeds new account from openclaw.json when no store match exists', async () => {
    mocks.listProviderAccounts.mockResolvedValue([]); // empty store
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['siliconflow']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(mocks.saveProviderAccount).toHaveBeenCalledTimes(1);
    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'siliconflow' }),
    );
    expect(result).toHaveLength(1);
  });

  it('uses store metadata when match exists (does not re-seed)', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'moonshot', vendorId: 'moonshot' as ProviderAccount['vendorId'], label: 'My Moonshot' }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['moonshot']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { moonshot: { baseUrl: 'https://api.moonshot.cn/v1' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(mocks.saveProviderAccount).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('My Moonshot');
  });

  it('matches UUID-based store account to openclaw key via getOpenClawProviderKeyForType', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'openrouter-uuid-1234', vendorId: 'openrouter' as ProviderAccount['vendorId'] }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['openrouter']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(mocks.saveProviderAccount).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('openrouter-uuid-1234');
  });

  it('prefers CN alias account over Global phantom for minimax-portal key', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({
        id: 'minimax-portal',
        vendorId: 'minimax-portal' as ProviderAccount['vendorId'],
        label: 'MiniMax (Global)',
        updatedAt: '2026-03-20T00:00:00.000Z',
      }),
      makeAccount({
        id: 'minimax-portal-cn-uuid',
        vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'],
        label: 'MiniMax (CN)',
        updatedAt: '2026-03-21T00:00:00.000Z',
      }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['minimax-portal']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { 'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    // Only CN should remain, phantom Global deleted from store
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('minimax-portal-cn-uuid');
    expect(result[0].label).toBe('MiniMax (CN)');
    expect(mocks.deleteProviderAccount).toHaveBeenCalledWith('minimax-portal');
  });

  it('shows only one CN when only CN account exists (no phantom)', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({
        id: 'minimax-portal-cn-uuid',
        vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'],
        label: 'MiniMax (CN)',
      }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['minimax-portal']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { 'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic' } },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('minimax-portal-cn-uuid');
    expect(mocks.saveProviderAccount).not.toHaveBeenCalled();
    expect(mocks.deleteProviderAccount).not.toHaveBeenCalled();
  });

  it('deduplicates multiple CN accounts from delete+re-add, keeps newest', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({
        id: 'minimax-portal-cn-uuid1',
        vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'],
        updatedAt: '2026-03-20T00:00:00.000Z',
      }),
      makeAccount({
        id: 'minimax-portal-cn-uuid2',
        vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'],
        updatedAt: '2026-03-21T00:00:00.000Z',
      }),
      makeAccount({
        id: 'minimax-portal-cn-uuid3',
        vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'],
        updatedAt: '2026-03-22T00:00:00.000Z',
      }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['minimax-portal']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { 'minimax-portal': {} },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('minimax-portal-cn-uuid3');
    expect(mocks.deleteProviderAccount).toHaveBeenCalledTimes(2);
    expect(mocks.deleteProviderAccount).toHaveBeenCalledWith('minimax-portal-cn-uuid1');
    expect(mocks.deleteProviderAccount).toHaveBeenCalledWith('minimax-portal-cn-uuid2');
  });

  it('handles multiple active providers from openclaw.json correctly', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({ id: 'openrouter-uuid', vendorId: 'openrouter' as ProviderAccount['vendorId'] }),
      makeAccount({ id: 'minimax-portal-cn-uuid', vendorId: 'minimax-portal-cn' as ProviderAccount['vendorId'] }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['openrouter', 'minimax-portal']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: {
        openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
        'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic' },
      },
      defaultModel: undefined,
    });

    const result = await service.listAccounts();

    expect(result).toHaveLength(2);
    const ids = result.map((a: ProviderAccount) => a.id);
    expect(ids).toContain('openrouter-uuid');
    expect(ids).toContain('minimax-portal-cn-uuid');
  });

  it('seeds a MiniMax CN account when minimax-portal baseUrl points at the CN endpoint', async () => {
    mocks.listProviderAccounts.mockResolvedValue([]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['minimax-portal']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: {
        'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic' },
      },
      defaultModel: undefined,
    });
    mocks.getProviderDefinition.mockImplementation((key: string) => {
      if (key === 'minimax-portal-cn') {
        return {
          id: 'minimax-portal-cn',
          name: 'MiniMax (CN)',
          defaultAuthMode: 'oauth_device',
          defaultModelId: 'MiniMax-M2.7',
          providerConfig: {
            baseUrl: 'https://api.minimaxi.com/anthropic',
            api: 'anthropic-messages',
          },
        };
      }
      return undefined;
    });

    const result = await service.listAccounts();

    expect(mocks.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'minimax-portal',
        vendorId: 'minimax-portal-cn',
        label: 'MiniMax (CN)',
        baseUrl: 'https://api.minimaxi.com/anthropic',
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'minimax-portal',
      vendorId: 'minimax-portal-cn',
      label: 'MiniMax (CN)',
    }));
  });

  it('seeds builtin providers discovered from auth profiles without explicit models.providers entries', async () => {
    mocks.listProviderAccounts.mockResolvedValue([]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['openai', 'anthropic']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: {
        openai: {},
        anthropic: {},
      },
      defaultModel: undefined,
    });
    mocks.getProviderDefinition.mockImplementation((key: string) => {
      if (key === 'openai') {
        return {
          id: 'openai',
          name: 'OpenAI',
          defaultAuthMode: 'oauth_browser',
          defaultModelId: 'gpt-5.2',
          providerConfig: {
            baseUrl: 'https://api.openai.com/v1',
            api: 'openai-responses',
          },
        };
      }
      if (key === 'anthropic') {
        return {
          id: 'anthropic',
          name: 'Anthropic',
          defaultAuthMode: 'api_key',
          defaultModelId: 'claude-opus-4-6',
        };
      }
      return undefined;
    });

    const result = await service.listAccounts();

    expect(mocks.saveProviderAccount).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'openai',
        vendorId: 'openai',
        authMode: 'oauth_browser',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.2',
      }),
      expect.objectContaining({
        id: 'anthropic',
        vendorId: 'anthropic',
        authMode: 'api_key',
        model: 'claude-opus-4-6',
      }),
    ]));
  });
});

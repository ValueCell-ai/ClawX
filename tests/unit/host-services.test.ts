import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyProxySettingsMock,
  assignChannelAccountToAgentMock,
  assignChannelToAgentMock,
  clearChannelBindingMock,
  createAgentMock,
  deleteAgentConfigMock,
  deleteChannelAccountConfigMock,
  deleteChannelConfigMock,
  ensureFeishuPluginInstalledMock,
  getAllSettingsMock,
  getChannelFormValuesMock,
  getSettingMock,
  listLogFilesMock,
  logDir,
  listAgentsSnapshotFromConfigMock,
  listAgentsSnapshotMock,
  listConfiguredChannelAccountsFromConfigMock,
  listConfiguredChannelsFromConfigMock,
  listConfiguredChannelsMock,
  providerAccountToConfigMock,
  providerServiceMock,
  readOpenClawConfigMock,
  readLogFileMock,
  removeAgentWorkspaceDirectoryMock,
  resetSettingsMock,
  saveChannelConfigMock,
  setSettingMock,
  syncDefaultProviderToRuntimeMock,
  syncDeletedProviderToRuntimeMock,
  syncSavedProviderToRuntimeMock,
  syncLaunchAtStartupSettingFromStoreMock,
  syncProxyConfigToOpenClawMock,
  testOpenClawConfigDir,
  updateAgentNameMock,
  validateApiKeyWithProviderMock,
} = vi.hoisted(() => ({
  applyProxySettingsMock: vi.fn(),
  assignChannelAccountToAgentMock: vi.fn(),
  assignChannelToAgentMock: vi.fn(),
  clearChannelBindingMock: vi.fn(),
  createAgentMock: vi.fn(),
  deleteAgentConfigMock: vi.fn(),
  deleteChannelAccountConfigMock: vi.fn(),
  deleteChannelConfigMock: vi.fn(),
  ensureFeishuPluginInstalledMock: vi.fn(),
  getAllSettingsMock: vi.fn(),
  getChannelFormValuesMock: vi.fn(),
  getSettingMock: vi.fn(),
  listLogFilesMock: vi.fn(),
  logDir: '/tmp/clawx-host-services-test-logs',
  listAgentsSnapshotFromConfigMock: vi.fn(),
  listAgentsSnapshotMock: vi.fn(),
  listConfiguredChannelAccountsFromConfigMock: vi.fn(),
  listConfiguredChannelsFromConfigMock: vi.fn(),
  listConfiguredChannelsMock: vi.fn(),
  providerAccountToConfigMock: vi.fn((account: Record<string, unknown>) => ({
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    model: account.model,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  })),
  providerServiceMock: {
    _deleteProviderApiKeyInternal: vi.fn(),
    _deleteProviderInternal: vi.fn(),
    _getDefaultProviderInternal: vi.fn(),
    _getProviderApiKeyInternal: vi.fn(),
    _getProviderInternal: vi.fn(),
    _hasProviderApiKeyInternal: vi.fn(),
    _listProvidersWithKeyInfoInternal: vi.fn(),
    _saveProviderInternal: vi.fn(),
    _setDefaultProviderInternal: vi.fn(),
    _setProviderApiKeyInternal: vi.fn(),
    createAccount: vi.fn(),
    deleteAccount: vi.fn(),
    getAccount: vi.fn(),
    getAccountApiKey: vi.fn(),
    getDefaultAccountId: vi.fn(),
    hasAccountApiKey: vi.fn(),
    listAccounts: vi.fn(),
    listAccountsKeyInfo: vi.fn(),
    listVendors: vi.fn(),
    setDefaultAccount: vi.fn(),
    updateAccount: vi.fn(),
  },
  readOpenClawConfigMock: vi.fn(),
  readLogFileMock: vi.fn(),
  removeAgentWorkspaceDirectoryMock: vi.fn(),
  resetSettingsMock: vi.fn(),
  saveChannelConfigMock: vi.fn(),
  setSettingMock: vi.fn(),
  syncDefaultProviderToRuntimeMock: vi.fn(),
  syncDeletedProviderToRuntimeMock: vi.fn(),
  syncSavedProviderToRuntimeMock: vi.fn(),
  syncLaunchAtStartupSettingFromStoreMock: vi.fn(),
  syncProxyConfigToOpenClawMock: vi.fn(),
  testOpenClawConfigDir: '/tmp/clawx-host-services-openclaw',
  updateAgentNameMock: vi.fn(),
  validateApiKeyWithProviderMock: vi.fn(),
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: (...args: unknown[]) => getAllSettingsMock(...args),
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  resetSettings: (...args: unknown[]) => resetSettingsMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

vi.mock('@electron/utils/openclaw-proxy', () => ({
  syncProxyConfigToOpenClaw: (...args: unknown[]) => syncProxyConfigToOpenClawMock(...args),
}));

vi.mock('@electron/main/proxy', () => ({
  applyProxySettings: (...args: unknown[]) => applyProxySettingsMock(...args),
}));

vi.mock('@electron/main/launch-at-startup', () => ({
  syncLaunchAtStartupSettingFromStore: (...args: unknown[]) => syncLaunchAtStartupSettingFromStoreMock(...args),
}));

vi.mock('@electron/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/logger')>();
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      getLogDir: () => logDir,
      getLogFilePath: () => join(logDir, 'clawx-current.log'),
      getRecentLogs: vi.fn(),
      listLogFiles: (...args: unknown[]) => listLogFilesMock(...args),
      readLogFile: (...args: unknown[]) => readLogFileMock(...args),
    },
    readLogFileTail: actual.readLogFileTail,
  };
});

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  deleteChannelAccountConfig: (...args: unknown[]) => deleteChannelAccountConfigMock(...args),
  deleteChannelConfig: (...args: unknown[]) => deleteChannelConfigMock(...args),
  getChannelFormValues: (...args: unknown[]) => getChannelFormValuesMock(...args),
  listConfiguredChannelAccountsFromConfig: (...args: unknown[]) => listConfiguredChannelAccountsFromConfigMock(...args),
  listConfiguredChannels: (...args: unknown[]) => listConfiguredChannelsMock(...args),
  listConfiguredChannelsFromConfig: (...args: unknown[]) => listConfiguredChannelsFromConfigMock(...args),
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
  saveChannelConfig: (...args: unknown[]) => saveChannelConfigMock(...args),
  setChannelDefaultAccount: vi.fn(),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(),
  validateChannelCredentials: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: (...args: unknown[]) => assignChannelAccountToAgentMock(...args),
  assignChannelToAgent: (...args: unknown[]) => assignChannelToAgentMock(...args),
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: (...args: unknown[]) => clearChannelBindingMock(...args),
  createAgent: (...args: unknown[]) => createAgentMock(...args),
  deleteAgentConfig: (...args: unknown[]) => deleteAgentConfigMock(...args),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
  listAgentsSnapshotFromConfig: (...args: unknown[]) => listAgentsSnapshotFromConfigMock(...args),
  removeAgentWorkspaceDirectory: (...args: unknown[]) => removeAgentWorkspaceDirectoryMock(...args),
  resolveAccountIdForAgent: vi.fn((agentId: string) => agentId === 'main' ? 'default' : agentId),
  updateAgentModel: vi.fn(),
  updateAgentName: (...args: unknown[]) => updateAgentNameMock(...args),
}));

vi.mock('@electron/utils/plugin-install', () => ({
  ensureDiscordPluginInstalled: vi.fn(),
  ensureDingTalkPluginInstalled: vi.fn(),
  ensureFeishuPluginInstalled: (...args: unknown[]) => ensureFeishuPluginInstalledMock(...args),
  ensureQQBotPluginInstalled: vi.fn(),
  ensureWeChatPluginInstalled: vi.fn(),
  ensureWeComPluginInstalled: vi.fn(),
  ensureWhatsAppPluginInstalled: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-workspace', () => ({
  ensureClawXContext: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: vi.fn(),
  syncAgentModelOverrideToRuntime: vi.fn(),
  syncDefaultProviderToRuntime: (...args: unknown[]) => syncDefaultProviderToRuntimeMock(...args),
  syncDeletedProviderApiKeyToRuntime: vi.fn(),
  syncDeletedProviderToRuntime: (...args: unknown[]) => syncDeletedProviderToRuntimeMock(...args),
  syncProviderApiKeyToRuntime: vi.fn(),
  syncSavedProviderToRuntime: (...args: unknown[]) => syncSavedProviderToRuntimeMock(...args),
  syncUpdatedProviderToRuntime: vi.fn(),
  getOpenClawProviderKey: vi.fn((type: string) => type),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => providerServiceMock,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  providerAccountToConfig: (...args: unknown[]) => providerAccountToConfigMock(...args),
}));

vi.mock('@electron/services/providers/provider-validation', () => ({
  validateApiKeyWithProvider: (...args: unknown[]) => validateApiKeyWithProviderMock(...args),
}));

vi.mock('@electron/utils/browser-oauth', () => ({
  browserOAuthManager: {
    setWindow: vi.fn(),
    startFlow: vi.fn(),
    stopFlow: vi.fn(),
    submitManualCode: vi.fn(),
  },
}));

vi.mock('@electron/utils/device-oauth', () => ({
  deviceOAuthManager: {
    setWindow: vi.fn(),
    startFlow: vi.fn(),
    stopFlow: vi.fn(),
  },
}));

vi.mock('@electron/utils/wechat-login', () => ({
  cancelWeChatLoginSession: vi.fn(),
  saveWeChatAccountState: vi.fn(),
  startWeChatLoginSession: vi.fn(),
  waitForWeChatLoginSession: vi.fn(),
}));

vi.mock('@electron/utils/whatsapp-login', () => ({
  whatsAppLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawConfigDir,
  getOpenClawDir: () => testOpenClawConfigDir,
  getOpenClawResolvedDir: () => testOpenClawConfigDir,
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-sdk', () => ({
  listDiscordDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listDiscordDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeDiscordMessagingTarget: vi.fn().mockReturnValue(undefined),
  listTelegramDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listTelegramDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeTelegramMessagingTarget: vi.fn().mockReturnValue(undefined),
  listSlackDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listSlackDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeSlackMessagingTarget: vi.fn().mockReturnValue(undefined),
  normalizeWhatsAppMessagingTarget: vi.fn().mockReturnValue(undefined),
}));

const baseSettings = {
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '',
  launchAtStartup: false,
  theme: 'system',
};

describe('host services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllSettingsMock.mockResolvedValue(baseSettings);
    readOpenClawConfigMock.mockResolvedValue({ channels: {} });
    listConfiguredChannelsMock.mockResolvedValue([]);
    listConfiguredChannelsFromConfigMock.mockResolvedValue([]);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({});
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    getChannelFormValuesMock.mockResolvedValue(undefined);
    providerServiceMock._listProvidersWithKeyInfoInternal.mockResolvedValue([]);
    providerServiceMock.getAccount.mockResolvedValue(null);
    providerServiceMock.getDefaultAccountId.mockResolvedValue(undefined);
    providerServiceMock.listAccounts.mockResolvedValue([]);
    providerServiceMock.listAccountsKeyInfo.mockResolvedValue([]);
    providerServiceMock.listVendors.mockResolvedValue([]);
    providerServiceMock.createAccount.mockImplementation(async (account: unknown) => account);
    providerServiceMock.setDefaultAccount.mockResolvedValue(undefined);
    validateApiKeyWithProviderMock.mockResolvedValue({ valid: true });
    ensureFeishuPluginInstalledMock.mockResolvedValue({ installed: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });
    mkdirSync(join(testOpenClawConfigDir, 'logs'), { recursive: true });
  });

  it('runs proxy side effects and restarts a running gateway after settings.set', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      restart: vi.fn(),
    };
    const { createSettingsApi } = await import('@electron/services/settings-api');

    await expect(createSettingsApi(gatewayManager as never).set({
      key: 'proxyServer',
      value: 'http://127.0.0.1:7890',
    })).resolves.toEqual({ success: true });

    expect(setSettingMock).toHaveBeenCalledWith('proxyServer', 'http://127.0.0.1:7890');
    expect(syncProxyConfigToOpenClawMock).toHaveBeenCalledWith(baseSettings, {
      preserveExistingWhenDisabled: false,
    });
    expect(applyProxySettingsMock).toHaveBeenCalledWith(baseSettings);
    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
  });

  it('runs launch-at-startup side effects after settings.setMany and reset', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'stopped', port: 18789 })),
      restart: vi.fn(),
    };
    const { createSettingsApi } = await import('@electron/services/settings-api');
    const settingsApi = createSettingsApi(gatewayManager as never);

    await expect(settingsApi.setMany({ patch: { launchAtStartup: true } })).resolves.toEqual({ success: true });
    await expect(settingsApi.reset()).resolves.toEqual({ success: true, settings: baseSettings });

    expect(setSettingMock).toHaveBeenCalledWith('launchAtStartup', true);
    expect(resetSettingsMock).toHaveBeenCalledTimes(1);
    expect(syncLaunchAtStartupSettingFromStoreMock).toHaveBeenCalledTimes(2);
    expect(syncProxyConfigToOpenClawMock).toHaveBeenCalledTimes(1);
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('routes gateway rpc through backpressure', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn(async (_method, _params, _timeoutMs, runner) => runner('chat.history', { limit: 1 }, 42)),
    };
    const { createGatewayApi } = await import('@electron/services/gateway-api');

    await expect(createGatewayApi(gatewayManager as never, backpressure as never).rpc({
      method: 'chat.history',
      params: { limit: 1 },
      timeoutMs: 42,
    })).resolves.toEqual({ ok: true });

    expect(backpressure.run).toHaveBeenCalledWith(
      'chat.history',
      { limit: 1 },
      42,
      expect.any(Function),
    );
    expect(gatewayManager.rpc).toHaveBeenCalledWith('chat.history', { limit: 1 }, 42);
  });

  it('exposes provider account snapshot actions through the typed providers service', async () => {
    const account = {
      id: 'custom-local',
      vendorId: 'custom',
      label: 'Local',
      authMode: 'api_key',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
      enabled: true,
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    };
    const keyInfo = [{ accountId: 'custom-local', hasKey: true, keyMasked: 'sk-***' }];
    providerServiceMock.listAccounts.mockResolvedValue([account]);
    providerServiceMock.listAccountsKeyInfo.mockResolvedValue(keyInfo);
    providerServiceMock.listVendors.mockResolvedValue([{ id: 'custom', name: 'Custom' }]);
    providerServiceMock.getDefaultAccountId.mockResolvedValue('custom-local');
    const { createProvidersApi } = await import('@electron/services/providers-api');
    const providersApi = createProvidersApi({
      gatewayManager: { debouncedReload: vi.fn() } as never,
      mainWindow: {} as never,
    });

    await expect(providersApi.accounts()).resolves.toEqual([account]);
    await expect(providersApi.accountKeyInfo()).resolves.toEqual(keyInfo);
    await expect(providersApi.vendors()).resolves.toEqual([{ id: 'custom', name: 'Custom' }]);
    await expect(providersApi.getDefaultAccount()).resolves.toEqual({ accountId: 'custom-local' });
  });

  it('validates provider keys using account metadata and caller options', async () => {
    providerServiceMock.getAccount.mockResolvedValue({
      id: 'custom-local',
      vendorId: 'custom',
      baseUrl: 'http://persisted.example/v1',
      apiProtocol: 'openai-completions',
    });
    validateApiKeyWithProviderMock.mockResolvedValue({ valid: true });
    const { createProvidersApi } = await import('@electron/services/providers-api');
    const providersApi = createProvidersApi({
      gatewayManager: {} as never,
      mainWindow: {} as never,
    });

    await expect(providersApi.validateKey({
      accountId: 'custom-local',
      apiKey: 'sk-test',
      options: { baseUrl: 'http://live.example/v1', apiProtocol: 'openai-responses' },
    })).resolves.toEqual({ valid: true });

    expect(validateApiKeyWithProviderMock).toHaveBeenCalledWith('custom', 'sk-test', {
      baseUrl: 'http://live.example/v1',
      apiProtocol: 'openai-responses',
    });
  });

  it('creates provider accounts and syncs runtime config through the typed providers service', async () => {
    const account = {
      id: 'custom-local',
      vendorId: 'custom',
      label: 'Local',
      authMode: 'api_key',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
      enabled: true,
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    };
    providerServiceMock.createAccount.mockResolvedValue(account);
    const gatewayManager = { debouncedReload: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).createAccount({ account, apiKey: 'sk-test' })).resolves.toEqual({
      success: true,
      account,
    });

    expect(providerServiceMock.createAccount).toHaveBeenCalledWith(account, 'sk-test');
    expect(providerAccountToConfigMock).toHaveBeenCalledWith(account);
    expect(syncSavedProviderToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-local', type: 'custom' }),
      'sk-test',
      gatewayManager,
    );
  });

  it('sets the default provider account and syncs runtime defaults', async () => {
    providerServiceMock.getDefaultAccountId.mockResolvedValue('old-default');
    const gatewayManager = { debouncedReload: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).setDefaultAccount({ accountId: 'custom-local' })).resolves.toEqual({ success: true });

    expect(providerServiceMock.setDefaultAccount).toHaveBeenCalledWith('custom-local');
    expect(syncDefaultProviderToRuntimeMock).toHaveBeenCalledWith('custom-local', gatewayManager);
  });

  it('promotes the newest enabled account before removing the deleted default from runtime', async () => {
    const deletedAccount = {
      id: 'default-account',
      vendorId: 'moonshot',
      label: 'Default',
      authMode: 'api_key',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const newestDisabledAccount = {
      ...deletedAccount,
      id: 'disabled-newest',
      label: 'Disabled Newest',
      enabled: false,
      updatedAt: '2026-06-03T00:00:00.000Z',
    };
    const olderEnabledAccount = {
      ...deletedAccount,
      id: 'enabled-older',
      label: 'Enabled Older',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const newestEnabledAccount = {
      ...deletedAccount,
      id: 'enabled-newest',
      label: 'Enabled Newest',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };
    providerServiceMock.getAccount.mockResolvedValue(deletedAccount);
    providerServiceMock.getDefaultAccountId.mockResolvedValue(deletedAccount.id);
    providerServiceMock.listAccounts.mockResolvedValue([
      deletedAccount,
      newestDisabledAccount,
      olderEnabledAccount,
      newestEnabledAccount,
    ]);
    const gatewayManager = { debouncedReload: vi.fn(), debouncedRestart: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).deleteAccount({ accountId: deletedAccount.id })).resolves.toEqual({ success: true });

    expect(providerServiceMock.setDefaultAccount).toHaveBeenCalledWith(newestEnabledAccount.id);
    expect(syncDefaultProviderToRuntimeMock).toHaveBeenCalledWith(newestEnabledAccount.id);
    expect(syncDeletedProviderToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: deletedAccount.id, type: deletedAccount.vendorId }),
      deletedAccount.id,
      gatewayManager,
      undefined,
    );
    expect(syncDefaultProviderToRuntimeMock.mock.invocationCallOrder[0])
      .toBeLessThan(syncDeletedProviderToRuntimeMock.mock.invocationCallOrder[0]);
  });

  it('does not change the default provider when deleting a non-default account', async () => {
    const account = {
      id: 'secondary-account',
      vendorId: 'moonshot',
      label: 'Secondary',
      authMode: 'api_key',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    providerServiceMock.getAccount.mockResolvedValue(account);
    providerServiceMock.getDefaultAccountId.mockResolvedValue('default-account');
    const gatewayManager = { debouncedReload: vi.fn(), debouncedRestart: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).deleteAccount({ accountId: account.id })).resolves.toEqual({ success: true });

    expect(providerServiceMock.listAccounts).not.toHaveBeenCalled();
    expect(providerServiceMock.setDefaultAccount).not.toHaveBeenCalled();
    expect(syncDefaultProviderToRuntimeMock).not.toHaveBeenCalled();
  });

  it('leaves the default unset when deleting the final provider account', async () => {
    const account = {
      id: 'only-account',
      vendorId: 'moonshot',
      label: 'Only Account',
      authMode: 'api_key',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    providerServiceMock.getAccount.mockResolvedValue(account);
    providerServiceMock.getDefaultAccountId.mockResolvedValue(account.id);
    providerServiceMock.listAccounts.mockResolvedValue([account]);
    const gatewayManager = { debouncedReload: vi.fn(), debouncedRestart: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).deleteAccount({ accountId: account.id })).resolves.toEqual({ success: true });

    expect(providerServiceMock.setDefaultAccount).not.toHaveBeenCalled();
    expect(syncDefaultProviderToRuntimeMock).not.toHaveBeenCalled();
  });

  it('builds channel accounts from config without gateway rpc in config mode', async () => {
    const openClawConfig = {
      channels: {
        feishu: {
          defaultAccount: 'default',
          accounts: {
            'team-bot': { appId: 'cli_team', appSecret: 'secret' },
          },
        },
      },
    };
    readOpenClawConfigMock.mockResolvedValue(openClawConfig);
    listConfiguredChannelsFromConfigMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({
      feishu: {
        defaultAccountId: 'team-bot',
        accountIds: ['team-bot'],
      },
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {
        'feishu:team-bot': 'main',
      },
    });
    const gatewayManager = {
      rpc: vi.fn(),
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      getDiagnostics: vi.fn(() => ({ consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 })),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).accounts({ mode: 'config' }))
      .resolves.toMatchObject({
        success: true,
        channels: [
          {
            channelType: 'feishu',
            defaultAccountId: 'team-bot',
            accounts: [
              {
                accountId: 'team-bot',
                configured: true,
                isDefault: true,
                agentId: 'main',
              },
            ],
          },
        ],
      });

    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('lists channel targets from session history and validates channel type', async () => {
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          deliveryContext: {
            channel: 'dingtalk',
            accountId: 'ding-main',
            to: 'cid-group-1',
          },
          displayName: 'Release Room',
          chatType: 'group',
          updatedAt: 100,
        },
      ],
    }));
    const { createChannelsApi } = await import('@electron/services/channels-api');
    const channelsApi = createChannelsApi({
      gatewayManager: {
        getStatus: vi.fn(() => ({ state: 'running' })),
        getDiagnostics: vi.fn(),
      } as never,
    });

    await expect(channelsApi.targets({ channelType: 'dingtalk', accountId: 'ding-main' }))
      .resolves.toEqual({
        success: true,
        channelType: 'dingtalk',
        accountId: 'ding-main',
        targets: [
          {
            value: 'cid-group-1',
            label: 'Release Room (cid-group-1)',
            kind: 'group',
          },
        ],
      });
    await expect(channelsApi.targets({ accountId: 'ding-main' })).rejects.toThrow('channelType is required');
  });

  it('saves channel binding for existing agents and schedules channel refresh', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      debouncedRestart: vi.fn(),
      debouncedReload: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).bindingSave({
      channelType: 'feishu',
      accountId: 'default',
      agentId: 'main',
    })).resolves.toEqual({ success: true });

    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'feishu', 'default');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(150);
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('installs plugin, saves config, ensures scoped binding, and schedules refresh on saveConfig', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    getChannelFormValuesMock.mockResolvedValue({ appId: 'old', appSecret: 'old-secret' });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      debouncedRestart: vi.fn(),
      debouncedReload: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).saveConfig({
      channelType: 'feishu',
      accountId: 'default',
      config: { appId: 'cli_new', appSecret: 'new-secret' },
    })).resolves.toEqual({ success: true });

    expect(ensureFeishuPluginInstalledMock).toHaveBeenCalledTimes(1);
    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'feishu',
      { appId: 'cli_new', appSecret: 'new-secret' },
      'default',
    );
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'feishu', 'default');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(150);
  });

  it('deletes agents by restarting gateway, removing workspace, and returning snapshot', async () => {
    const snapshot = {
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    };
    const removedEntry = { id: 'code', workspace: '/tmp/code-workspace' };
    deleteAgentConfigMock.mockResolvedValue({ snapshot, removedEntry });
    removeAgentWorkspaceDirectoryMock.mockResolvedValue(undefined);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      restart: vi.fn().mockResolvedValue(undefined),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).delete({ id: 'code' }))
      .resolves.toEqual({ success: true, ...snapshot });

    expect(deleteAgentConfigMock).toHaveBeenCalledWith('code');
    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
    expect(removeAgentWorkspaceDirectoryMock).toHaveBeenCalledWith(removedEntry);
  });

  it('updates agent model and schedules gateway reload', async () => {
    const snapshot = {
      agents: [{ id: 'main', modelRef: 'custom-enterpri/claude-sonnet-4' }],
      defaultAgentId: 'main',
      defaultModelRef: 'custom-enterpri/gpt-5.4',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    };
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');
    const agentConfig = await import('@electron/utils/agent-config');
    const providerRuntimeSync = await import('@electron/services/providers/provider-runtime-sync');
    vi.mocked(agentConfig.updateAgentModel).mockResolvedValue(snapshot as never);
    vi.mocked(providerRuntimeSync.syncAllProviderAuthToRuntime).mockResolvedValue(undefined);
    vi.mocked(providerRuntimeSync.syncAgentModelOverrideToRuntime).mockResolvedValue(undefined);

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).updateModel({
      id: 'main',
      modelRef: 'custom-enterpri/claude-sonnet-4',
    })).resolves.toEqual({ success: true, ...snapshot });

    expect(agentConfig.updateAgentModel).toHaveBeenCalledWith('main', 'custom-enterpri/claude-sonnet-4');
    expect(providerRuntimeSync.syncAllProviderAuthToRuntime).toHaveBeenCalledTimes(1);
    expect(providerRuntimeSync.syncAgentModelOverrideToRuntime).toHaveBeenCalledWith('main');
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('assigns agent channels and schedules gateway reload', async () => {
    const snapshot = {
      agents: [{ id: 'main', channelTypes: ['feishu'] }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: { feishu: 'main' },
      channelAccountOwners: {},
    };
    assignChannelToAgentMock.mockResolvedValue(snapshot);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).assignChannel({
      id: 'main',
      channelType: 'feishu',
    })).resolves.toEqual({ success: true, ...snapshot });

    expect(assignChannelToAgentMock).toHaveBeenCalledWith('main', 'feishu');
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('returns diagnostics snapshot with channel view and log tails', async () => {
    writeFileSync(join(testOpenClawConfigDir, 'logs', 'gateway.log'), 'gateway-one\ngateway-two\n');
    readLogFileMock.mockResolvedValue('clawx-log-tail');
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });
    listConfiguredChannelsFromConfigMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default'],
      },
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {
        'feishu:default': 'main',
      },
    });
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        channels: { feishu: { configured: true } },
        channelAccounts: {
          feishu: [{ accountId: 'default', configured: true, connected: true, running: true, linked: true }],
        },
        channelDefaultAccountId: { feishu: 'default' },
      }),
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      getDiagnostics: vi.fn(() => ({
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 0,
      })),
      getCapabilitySnapshot: vi.fn(() => ({ rpc: true })),
    };
    const { createDiagnosticsApi } = await import('@electron/services/diagnostics-api');

    const snapshot = await createDiagnosticsApi({ gatewayManager: gatewayManager as never }).gatewaySnapshot();

    expect(snapshot).toMatchObject({
      platform: process.platform,
      channels: [
        expect.objectContaining({
          channelType: 'feishu',
          accounts: [expect.objectContaining({ accountId: 'default', agentId: 'main' })],
        }),
      ],
      clawxLogTail: 'clawx-log-tail',
      gateway: expect.objectContaining({
        state: 'healthy',
        capabilities: { rpc: true },
      }),
    });
    expect(snapshot.gatewayLogTail).toContain('gateway-one');
    expect(snapshot.gatewayErrLogTail).toBe('');
  });

  it('reads only selected log files from the log directory', async () => {
    const selectedLog = join(logDir, 'clawx-selected.log');
    writeFileSync(selectedLog, 'one\ntwo\nthree\n');
    listLogFilesMock.mockResolvedValue([{ name: 'clawx-selected.log', path: selectedLog, size: 14, modified: 'now' }]);
    const { createLogsApi } = await import('@electron/services/logs-api');

    await expect(createLogsApi().readFile({ path: selectedLog, tailLines: 2 })).resolves.toEqual({
      content: 'two\nthree\n',
    });
    await expect(createLogsApi().readFile({ path: join(tmpdir(), 'outside.log') })).rejects.toThrow(
      'Invalid log file path',
    );
  });

  it('sends staged media through the typed chat service with gateway attachments', async () => {
    const mediaPath = join(tmpdir(), `clawx-host-services-media-${Date.now()}.png`);
    writeFileSync(mediaPath, 'fake-image-bytes');
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ runId: 'run-123' }),
    };
    const { createChatApi } = await import('@electron/services/chat-api');

    await expect(createChatApi({ gatewayManager: gatewayManager as never }).sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'inspect this',
      idempotencyKey: 'idem-123',
      media: [{ filePath: mediaPath, mimeType: 'image/png', fileName: 'image.png' }],
    })).resolves.toEqual({ success: true, result: { runId: 'run-123' } });

    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'chat.send',
      {
        sessionKey: 'agent:main:main',
        message: `inspect this\n\n[media attached: ${mediaPath} (image/png) | ${mediaPath}]`,
        deliver: false,
        idempotencyKey: 'idem-123',
        attachments: [{
          content: Buffer.from('fake-image-bytes').toString('base64'),
          mimeType: 'image/png',
          fileName: 'image.png',
        }],
      },
      120000,
    );
  });

  it('loads session summaries and transcript history through the typed sessions service', async () => {
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          key: 'agent:main:abc123',
          file: 'abc123.jsonl',
        },
      ],
    }));
    writeFileSync(join(sessionsDir, 'abc123.jsonl'), [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'Hello from transcript',
          timestamp: 1000,
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: 'Hi',
          timestamp: 1001,
        },
      }),
    ].join('\n'));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    await expect(sessionsApi.summaries({ sessionKeys: ['agent:main:abc123'] }))
      .resolves.toEqual({
        success: true,
        summaries: [{
          sessionKey: 'agent:main:abc123',
          firstUserText: 'Hello from transcript',
          lastTimestamp: 1001000,
        }],
      });
    await expect(sessionsApi.history({ sessionKey: 'agent:main:abc123', limit: 5 }))
      .resolves.toMatchObject({
        success: true,
        messages: [
          { role: 'user', content: 'Hello from transcript', timestamp: 1000 },
          { role: 'assistant', content: 'Hi', timestamp: 1001 },
        ],
      });
  });
});

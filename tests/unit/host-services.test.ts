import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  ensureScopedChannelBindingMock,
  ensureClawXContextMock,
  ensureWeChatPluginInstalledMock,
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
  migrateLegacyChannelWideBindingMock,
  providerAccountToConfigMock,
  providerServiceMock,
  readOpenClawConfigMock,
  readLogFileMock,
  removeAgentWorkspaceDirectoryMock,
  resetSettingsMock,
  saveChannelConfigMock,
  setChannelDefaultAccountMock,
  setChannelEnabledMock,
  setSettingMock,
  syncDefaultProviderToRuntimeMock,
  syncDeletedProviderToRuntimeMock,
  syncSavedProviderToRuntimeMock,
  syncLaunchAtStartupSettingFromStoreMock,
  syncProxyConfigToOpenClawMock,
  testOpenClawConfigDir,
  updateAgentNameMock,
  validateApiKeyWithProviderMock,
  saveWeChatAccountStateMock,
  startWeChatLoginSessionMock,
  waitForWeChatLoginSessionMock,
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
  ensureScopedChannelBindingMock: vi.fn(),
  ensureClawXContextMock: vi.fn(),
  ensureWeChatPluginInstalledMock: vi.fn(),
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
  migrateLegacyChannelWideBindingMock: vi.fn(),
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
  setChannelDefaultAccountMock: vi.fn(),
  setChannelEnabledMock: vi.fn(),
  setSettingMock: vi.fn(),
  syncDefaultProviderToRuntimeMock: vi.fn(),
  syncDeletedProviderToRuntimeMock: vi.fn(),
  syncSavedProviderToRuntimeMock: vi.fn(),
  syncLaunchAtStartupSettingFromStoreMock: vi.fn(),
  syncProxyConfigToOpenClawMock: vi.fn(),
  testOpenClawConfigDir: '/tmp/clawx-host-services-openclaw',
  updateAgentNameMock: vi.fn(),
  validateApiKeyWithProviderMock: vi.fn(),
  saveWeChatAccountStateMock: vi.fn(),
  startWeChatLoginSessionMock: vi.fn(),
  waitForWeChatLoginSessionMock: vi.fn(),
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
  setChannelDefaultAccount: (...args: unknown[]) => setChannelDefaultAccountMock(...args),
  setChannelEnabled: (...args: unknown[]) => setChannelEnabledMock(...args),
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
  ensureScopedChannelBinding: (...args: unknown[]) => ensureScopedChannelBindingMock(...args),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
  listAgentsSnapshotFromConfig: (...args: unknown[]) => listAgentsSnapshotFromConfigMock(...args),
  migrateLegacyChannelWideBinding: (...args: unknown[]) => migrateLegacyChannelWideBindingMock(...args),
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
  ensureWeChatPluginInstalled: (...args: unknown[]) => ensureWeChatPluginInstalledMock(...args),
  ensureWeComPluginInstalled: vi.fn(),
  ensureWhatsAppPluginInstalled: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-workspace', () => ({
  ensureClawXContext: (...args: unknown[]) => ensureClawXContextMock(...args),
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

vi.mock('@electron/utils/openclaw-auth', () => ({
  removeProviderFromOpenClaw: vi.fn(),
  saveProviderKeyToOpenClaw: vi.fn(),
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
  saveWeChatAccountState: (...args: unknown[]) => saveWeChatAccountStateMock(...args),
  startWeChatLoginSession: (...args: unknown[]) => startWeChatLoginSessionMock(...args),
  waitForWeChatLoginSession: (...args: unknown[]) => waitForWeChatLoginSessionMock(...args),
}));

vi.mock('@electron/utils/whatsapp-login', () => ({
  whatsAppLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (path: string) => path,
  getOpenClawConfigDir: () => testOpenClawConfigDir,
  getOpenClawDir: () => testOpenClawConfigDir,
  getOpenClawResolvedDir: () => testOpenClawConfigDir,
  resolveOpenClawConfigDir: () => testOpenClawConfigDir,
  resolveOpenClawStateDir: () => testOpenClawConfigDir,
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
  chatWorkspacePath: '~/.openclaw/workspace',
  recentWorkspacePaths: ['~/.openclaw/workspace'],
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
    ensureWeChatPluginInstalledMock.mockResolvedValue({ installed: true });
    ensureClawXContextMock.mockResolvedValue(undefined);
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

  it('accepts chat workspace settings through the typed settings API', async () => {
    setSettingMock.mockResolvedValue(undefined);

    const { createSettingsApi } = await import('@electron/services/settings-api');
    const api = createSettingsApi({
      getStatus: () => ({ state: 'stopped' }),
      restart: vi.fn(),
    } as never);

    await expect(api.set({ key: 'chatWorkspacePath', value: '/Users/alex/workspace/ClawX' })).resolves.toEqual({ success: true });
    await expect(api.set({ key: 'recentWorkspacePaths', value: ['/Users/alex/workspace/ClawX'] })).resolves.toEqual({ success: true });
    expect(setSettingMock).toHaveBeenCalledWith('chatWorkspacePath', '/Users/alex/workspace/ClawX');
    expect(setSettingMock).toHaveBeenCalledWith('recentWorkspacePaths', ['/Users/alex/workspace/ClawX']);
  });

  it('routes validated generic gateway rpc directly to the manager', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const gatewayApi = createGatewayApi(gatewayManager as never);

    await expect(gatewayApi.rpc({
      method: ' sessions.list ',
      params: { includeDerivedTitles: true },
      timeoutMs: 42,
    })).resolves.toEqual({ ok: true });

    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'sessions.list',
      { includeDerivedTitles: true },
      42,
    );
    await expect(gatewayApi.rpc({ method: '   ' })).rejects.toThrow('Invalid gateway RPC method');
    await expect(gatewayApi.rpc({ method: 'status', timeoutMs: 0 })).rejects.toThrow(
      'Invalid gateway RPC timeout',
    );
    expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
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
      options: {
        baseUrl: 'http://live.example/v1',
        apiProtocol: 'openai-responses',
        modelId: 'live-model',
      },
    })).resolves.toEqual({ valid: true });

    expect(validateApiKeyWithProviderMock).toHaveBeenCalledWith('custom', 'sk-test', {
      baseUrl: 'http://live.example/v1',
      apiProtocol: 'openai-responses',
      modelId: 'live-model',
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

  it('removes provider runtime state before deleting the local provider record', async () => {
    const provider = {
      id: 'custom-local',
      name: 'Local',
      type: 'custom',
      baseUrl: 'http://127.0.0.1:1234/v1',
      enabled: true,
    };
    providerServiceMock._getProviderInternal.mockResolvedValue(provider);
    const gatewayManager = {};
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).delete({ providerId: provider.id })).resolves.toEqual({ success: true });

    expect(syncDeletedProviderToRuntimeMock).toHaveBeenCalledWith(provider, provider.id, gatewayManager);
    expect(syncDeletedProviderToRuntimeMock.mock.invocationCallOrder[0])
      .toBeLessThan(providerServiceMock._deleteProviderInternal.mock.invocationCallOrder[0]);
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

  it('saves channel binding for existing agents without scheduling lifecycle work', async () => {
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
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('requests legacy migration inside the scoped binding transaction', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'research', name: 'Research' }],
      defaultAgentId: 'research',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: {} as never }).bindingSave({
      channelType: 'feishu',
      accountId: 'research',
      agentId: 'research',
    })).resolves.toEqual({ success: true });

    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith(
      'research',
      'feishu',
      'research',
      { migrateLegacy: true },
    );
    expect(migrateLegacyChannelWideBindingMock).not.toHaveBeenCalled();
  });

  it('commits a changed plugin channel save without racing the native config reload', async () => {
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
      restart: vi.fn().mockResolvedValue(undefined),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).saveConfig({
      channelType: 'feishu',
      accountId: 'default',
      config: { appId: 'cli_new', appSecret: 'new-secret' },
    })).resolves.toEqual({ success: true, activationPending: true });

    expect(ensureFeishuPluginInstalledMock).toHaveBeenCalledTimes(1);
    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'feishu',
      { appId: 'cli_new', appSecret: 'new-secret' },
      'default',
    );
    expect(ensureScopedChannelBindingMock).toHaveBeenCalledWith('feishu', 'default');
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('keeps bundled Telegram on the native config reload path', async () => {
    getChannelFormValuesMock.mockResolvedValue({ botToken: 'old-token', allowedUsers: '1' });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      restart: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).saveConfig({
      channelType: 'telegram',
      accountId: 'default',
      config: { botToken: 'new-token', allowedUsers: '1' },
    })).resolves.toEqual({ success: true });

    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'telegram',
      { botToken: 'new-token', allowedUsers: '1' },
      'default',
    );
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('deletes agents by awaiting config commit then removing workspace without restarting', async () => {
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
      getStatus: vi.fn(() => ({ state: 'stopped' })),
      restart: vi.fn().mockResolvedValue(undefined),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).delete({ id: 'code' }))
      .resolves.toEqual({ success: true, ...snapshot });

    expect(deleteAgentConfigMock).toHaveBeenCalledWith('code');
    expect(gatewayManager.restart).not.toHaveBeenCalled();
    expect(removeAgentWorkspaceDirectoryMock).toHaveBeenCalledWith(removedEntry);
    expect(deleteAgentConfigMock.mock.invocationCallOrder[0])
      .toBeLessThan(removeAgentWorkspaceDirectoryMock.mock.invocationCallOrder[0]);
  });

  it('updates agent model without scheduling lifecycle work', async () => {
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
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('assigns agent channels without scheduling lifecycle work', async () => {
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
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('creates and updates agents without scheduling lifecycle work', async () => {
    const snapshot = {
      agents: [{ id: 'writer', name: 'Writer' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    };
    createAgentMock.mockResolvedValue(snapshot);
    updateAgentNameMock.mockResolvedValue(snapshot);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
      debouncedRestart: vi.fn(),
      restart: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');
    const agentsApi = createAgentsApi({ gatewayManager: gatewayManager as never });

    await expect(agentsApi.create({ name: 'Writer' })).resolves.toEqual({ success: true, ...snapshot });
    await expect(agentsApi.update({ id: 'writer', name: 'Writer' })).resolves.toEqual({ success: true, ...snapshot });

    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('removes agent channel bindings without scheduling lifecycle work', async () => {
    listAgentsSnapshotMock
      .mockResolvedValueOnce({
        agents: [{ id: 'writer' }],
        defaultAgentId: 'main',
        defaultModelRef: null,
        configuredChannelTypes: ['feishu'],
        channelOwners: { feishu: 'writer' },
        channelAccountOwners: { 'feishu:writer': 'writer' },
      })
      .mockResolvedValueOnce({
        agents: [{ id: 'writer' }],
        defaultAgentId: 'main',
        defaultModelRef: null,
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
      debouncedRestart: vi.fn(),
      restart: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await createAgentsApi({ gatewayManager: gatewayManager as never }).removeChannel({
      id: 'writer',
      channelType: 'feishu',
    });

    expect(deleteChannelAccountConfigMock).toHaveBeenCalledWith('feishu', 'writer');
    expect(clearChannelBindingMock).toHaveBeenCalledWith('feishu', 'writer');
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('handles channel actions and restarts a running Gateway for a no-change plugin save', async () => {
    getChannelFormValuesMock.mockResolvedValue({ appId: 'same', appSecret: 'same-secret' });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
      debouncedRestart: vi.fn(),
      restart: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');
    const channelsApi = createChannelsApi({ gatewayManager: gatewayManager as never });

    await channelsApi.setDefaultAccount({ channelType: 'feishu', accountId: 'default' });
    await channelsApi.bindingDelete({ channelType: 'feishu', accountId: 'default' });
    await channelsApi.setEnabled({ channelType: 'feishu', enabled: true });
    await channelsApi.deleteConfig({ channelType: 'feishu', accountId: 'default' });
    await channelsApi.deleteConfig({ channelType: 'feishu' });
    await channelsApi.startLogin({ channelType: 'whatsapp', accountId: 'default' });
    await expect(channelsApi.saveConfig({
      channelType: 'feishu',
      accountId: 'default',
      config: { appId: 'same', appSecret: 'same-secret' },
    })).resolves.toEqual({ success: true, noChange: true, activationPending: true });

    expect(setChannelDefaultAccountMock).toHaveBeenCalledWith('feishu', 'default');
    expect(clearChannelBindingMock).toHaveBeenCalledWith('feishu', 'default');
    expect(setChannelEnabledMock).toHaveBeenCalledWith('feishu', true);
    expect(deleteChannelAccountConfigMock).toHaveBeenCalledWith('feishu', 'default');
    expect(deleteChannelConfigMock).toHaveBeenCalledWith('feishu');
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(0);
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('does not register OAuth success restart listeners', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');

    expect(source).not.toMatch(/\.on\(['"]oauth:success['"]/);
    expect(source).not.toContain('debouncedRestart(8000)');
  });

  it('persists successful WeChat login and restarts a running Gateway', async () => {
    startWeChatLoginSessionMock.mockResolvedValue({
      qrcodeUrl: 'https://example.com/qr',
      sessionKey: 'session-1',
    });
    waitForWeChatLoginSessionMock.mockResolvedValue({
      connected: true,
      accountId: 'wx-account',
      botToken: 'wx-token',
      baseUrl: 'https://api.example.com',
      userId: 'wx-user',
    });
    saveWeChatAccountStateMock.mockResolvedValue('wx-account');
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['openclaw-weixin'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
      debouncedRestart: vi.fn(),
      restart: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await createChannelsApi({ gatewayManager: gatewayManager as never }).startLogin({ channelType: 'wechat' });

    await vi.waitFor(() => {
      expect(saveChannelConfigMock).toHaveBeenCalledWith('wechat', { enabled: true }, 'wx-account');
      expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(0);
    });
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.restart).not.toHaveBeenCalled();
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

  it('records and returns ACP diagnostics trace entries', async () => {
    const { clearAcpTraceForTests } = await import('@electron/services/acp-trace');
    const { createDiagnosticsApi } = await import('@electron/services/diagnostics-api');
    clearAcpTraceForTests();
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running', port: 18789 })) };
    const diagnosticsApi = createDiagnosticsApi({ gatewayManager: gatewayManager as never });

    await expect(diagnosticsApi.recordAcpTrace({
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 1,
      details: { reason: 'no-fresh-context' },
    })).resolves.toEqual({ success: true });

    const snapshot = await diagnosticsApi.acpTrace();
    expect(snapshot.entries).toContainEqual(expect.objectContaining({
      source: 'renderer',
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 1,
    }));
  });

  it('rejects malformed ACP diagnostics trace payloads', async () => {
    const { clearAcpTraceForTests } = await import('@electron/services/acp-trace');
    const { createDiagnosticsApi } = await import('@electron/services/diagnostics-api');
    clearAcpTraceForTests();
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running', port: 18789 })) };
    const diagnosticsApi = createDiagnosticsApi({ gatewayManager: gatewayManager as never });

    await expect(diagnosticsApi.recordAcpTrace({ event: '' })).resolves.toEqual({
      success: false,
      error: 'Invalid ACP trace payload',
    });
    await expect(diagnosticsApi.acpTrace()).resolves.toMatchObject({ entries: [] });
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

  it('registers exactly the four ACP chat actions', async () => {
    const { createChatApi } = await import('@electron/services/chat-api');

    expect(Object.keys(createChatApi({
      gatewayManager: {} as never,
      mainWindow: {} as never,
      acpSessionAccessRegistry: {} as never,
    }))).toEqual([
      'loadAcpSession',
      'sendAcpPrompt',
      'cancelAcpSession',
      'respondAcpPermission',
    ]);
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
          content: '[Working directory: ~/.openclaw/workspace]\n\nSender: test-user\n[Working directory: ~/.openclaw/workspace]\n\nHello from transcript',
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
          workspacePath: null,
        }],
      });
    await expect(sessionsApi.history({ sessionKey: 'agent:main:abc123', limit: 5 }))
      .resolves.toMatchObject({
        success: true,
        messages: [
          {
            role: 'user',
            content: '[Working directory: ~/.openclaw/workspace]\n\nSender: test-user\n[Working directory: ~/.openclaw/workspace]\n\nHello from transcript',
            timestamp: 1000,
          },
          { role: 'assistant', content: 'Hi', timestamp: 1001 },
        ],
      });
  });

  it('delegates all attachment-scoped file operations from the files service', async () => {
    const attachmentAccess = {
      resolveAttachment: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable', displayName: 'file' }),
      readAttachmentText: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
      readAttachmentBinary: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
      openAttachment: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
      listAttachmentOpenHandlers: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
      openAttachmentWith: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
      revealAttachment: vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' }),
    };
    const { createFilesApi } = await import('@electron/services/files-api');
    const filesApi = createFilesApi({ attachmentAccess: attachmentAccess as never });
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///tmp/a.txt' };

    await filesApi.resolveAttachment({ ref });
    await filesApi.readAttachmentText(ref);
    await filesApi.readAttachmentBinary({ ref, maxBytes: 5 });
    await filesApi.openAttachment(ref);
    await filesApi.listAttachmentOpenHandlers(ref);
    await filesApi.openAttachmentWith({ ref, handlerId: 'com.apple.Preview' });
    await filesApi.revealAttachment(ref);

    expect(attachmentAccess.resolveAttachment).toHaveBeenCalledWith({ ref });
    expect(attachmentAccess.readAttachmentText).toHaveBeenCalledWith(ref);
    expect(attachmentAccess.readAttachmentBinary).toHaveBeenCalledWith({ ref, maxBytes: 5 });
    expect(attachmentAccess.openAttachment).toHaveBeenCalledWith(ref);
    expect(attachmentAccess.listAttachmentOpenHandlers).toHaveBeenCalledWith(ref);
    expect(attachmentAccess.openAttachmentWith).toHaveBeenCalledWith({ ref, handlerId: 'com.apple.Preview' });
    expect(attachmentAccess.revealAttachment).toHaveBeenCalledWith(ref);
  });

  it('fails attachment-scoped operations safely when attachment access is absent', async () => {
    const { createFilesApi } = await import('@electron/services/files-api');
    const filesApi = createFilesApi();
    const ref = { sessionKey: 'agent:main:s1', generation: 1, uri: 'file:///tmp/a.txt' };

    await expect(filesApi.listAttachmentOpenHandlers(ref)).resolves.toEqual({
      ok: false,
      error: 'operationFailed',
    });
    await expect(filesApi.openAttachmentWith({ ref, handlerId: 'com.apple.Preview' })).resolves.toEqual({
      ok: false,
      error: 'operationFailed',
    });
    await expect(filesApi.revealAttachment(ref)).resolves.toEqual({
      ok: false,
      error: 'operationFailed',
    });
  });

  it('registers exactly one typed web browser service without legacy IPC', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');

    expect(source.match(/\bwebBrowser\s*:/g)).toHaveLength(1);
    expect(source).toContain('webBrowser: createWebBrowserApi({ browserSession, registry })');
    expect(source).not.toMatch(/['"]webBrowser:/);
  });

  it('configures browser policy and typed handlers before the initial renderer load', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8');
    const createWindowSource = source.slice(
      source.indexOf('function createWindow('),
      source.indexOf('function loadMainWindow('),
    );
    const configureIndex = source.indexOf('configureWebBrowserSession({');
    const firstInitializationAwaitIndex = source.indexOf(
      'await initTelemetry();',
      source.indexOf('async function initialize()'),
    );
    const createMainWindowIndex = source.indexOf('const window = createMainWindow();');
    const registerHandlersIndex = source.indexOf('registerIpcHandlers(');
    const loadRendererIndex = source.indexOf('loadMainWindow(window);');
    const appReadySource = source.slice(
      source.indexOf('app.whenReady().then('),
      source.indexOf("app.on('window-all-closed'"),
    );
    const initializeCompleteIndex = appReadySource.indexOf('await initialize();');
    const activateHandlerIndex = appReadySource.indexOf("app.on('activate'");

    expect(source.match(/new WebBrowserGuestRegistry\(\)/g)).toHaveLength(1);
    expect(configureIndex).toBeGreaterThan(-1);
    expect(configureIndex).toBeLessThan(firstInitializationAwaitIndex);
    expect(createMainWindowIndex).toBeGreaterThan(configureIndex);
    expect(registerHandlersIndex).toBeGreaterThan(createMainWindowIndex);
    expect(loadRendererIndex).toBeGreaterThan(registerHandlersIndex);
    expect(initializeCompleteIndex).toBeGreaterThan(-1);
    expect(activateHandlerIndex).toBeGreaterThan(initializeCompleteIndex);
    expect(appReadySource).not.toContain('void initialize()');
    expect(createWindowSource.indexOf('new BrowserWindow(')).toBeLessThan(
      createWindowSource.indexOf('installWebBrowserGuestPolicy('),
    );
    expect(createWindowSource).not.toContain('.loadURL(');
    expect(createWindowSource).not.toContain('.loadFile(');
    expect(source).toContain('getMainWindow: () => mainWindow');
  });
});

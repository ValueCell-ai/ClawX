import { beforeEach, describe, expect, it, vi } from 'vitest';

const syncProxyConfigToOpenClawMock = vi.fn();
const sanitizeOpenClawConfigMock = vi.fn();
const cleanupDanglingWeChatPluginStateMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('@electron/utils/runtime-flags', () => ({
  isOpenClawConfigMutationEnabled: () => false,
}));

vi.mock('@electron/utils/openclaw-proxy', () => ({
  syncProxyConfigToOpenClaw: syncProxyConfigToOpenClawMock,
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  sanitizeOpenClawConfig: sanitizeOpenClawConfigMock,
  batchSyncConfigFields: vi.fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: cleanupDanglingWeChatPluginStateMock,
  listConfiguredChannelsFromConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('gateway config sync safe mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('skips prelaunch OpenClaw mutation work when config mutation is disabled', async () => {
    const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');

    const result = await syncGatewayConfigBeforeLaunch({
      theme: 'system',
      language: 'en',
      startMinimized: false,
      launchAtStartup: false,
      telemetryEnabled: true,
      machineId: '',
      hasReportedInstall: false,
      gatewayAutoStart: true,
      gatewayPort: 18789,
      gatewayToken: 'token',
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
      externalGatewayEnabled: true,
      externalGatewayUrl: 'ws://127.0.0.1:4000/gateway',
      gatewaySpawnEnabled: false,
      gatewayKillOnConflictEnabled: false,
      openclawConfigMutationEnabled: false,
      updateChecksEnabled: false,
      providerValidationEnabled: false,
      oauthEnabled: false,
      externalUrlOpeningEnabled: false,
      connectivityProbeEnabled: false,
      updateChannel: 'stable',
      autoCheckUpdate: true,
      autoDownloadUpdate: false,
      skippedVersions: [],
      sidebarCollapsed: false,
      devModeUnlocked: false,
      selectedBundles: [],
      enabledSkills: [],
      disabledSkills: [],
    }, '/tmp/clawx-openclaw');

    expect(result.timingsMs).toEqual({});
    expect(result.maintenance).toEqual({});
    expect(result.configuredChannels).toEqual([]);
    expect(syncProxyConfigToOpenClawMock).not.toHaveBeenCalled();
    expect(sanitizeOpenClawConfigMock).not.toHaveBeenCalled();
    expect(cleanupDanglingWeChatPluginStateMock).not.toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith(
      '[gateway-config-sync] Skipping prelaunch OpenClaw mutation because config mutation is disabled',
    );
  });
});

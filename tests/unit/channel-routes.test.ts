import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const listConfiguredChannelsMock = vi.fn();
const listConfiguredChannelAccountsMock = vi.fn();
const readOpenClawConfigMock = vi.fn();
const listAgentsSnapshotMock = vi.fn();
const sendJsonMock = vi.fn();
const proxyAwareFetchMock = vi.fn();
const saveChannelConfigMock = vi.fn();
const setChannelDefaultAccountMock = vi.fn();
const assignChannelAccountToAgentMock = vi.fn();
const clearChannelBindingMock = vi.fn();
const parseJsonBodyMock = vi.fn();
const testOpenClawConfigDir = join(tmpdir(), 'clawx-tests', 'channel-routes-openclaw');

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  deleteChannelAccountConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  getChannelFormValues: vi.fn(),
  listConfiguredChannelAccounts: (...args: unknown[]) => listConfiguredChannelAccountsMock(...args),
  listConfiguredChannelAccountsFromConfig: (...args: unknown[]) => listConfiguredChannelAccountsMock(...args),
  listConfiguredChannels: (...args: unknown[]) => listConfiguredChannelsMock(...args),
  listConfiguredChannelsFromConfig: (...args: unknown[]) => listConfiguredChannelsMock(...args),
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
  saveChannelConfig: (...args: unknown[]) => saveChannelConfigMock(...args),
  setChannelDefaultAccount: (...args: unknown[]) => setChannelDefaultAccountMock(...args),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(),
  validateChannelCredentials: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: (...args: unknown[]) => assignChannelAccountToAgentMock(...args),
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: (...args: unknown[]) => clearChannelBindingMock(...args),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
  listAgentsSnapshotFromConfig: (...args: unknown[]) => listAgentsSnapshotMock(...args),
}));

vi.mock('@electron/utils/plugin-install', () => ({
  ensureDingTalkPluginInstalled: vi.fn(),
  ensureFeishuPluginInstalled: vi.fn(),
  ensureWeChatPluginInstalled: vi.fn(),
  ensureWeComPluginInstalled: vi.fn(),
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

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawConfigDir,
  getOpenClawDir: () => testOpenClawConfigDir,
  getOpenClawResolvedDir: () => testOpenClawConfigDir,
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

// Stub openclaw SDK functions that are dynamically loaded via createRequire
// in the real code — the extracted utility module is easy to mock.
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

describe('handleChannelRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
    proxyAwareFetchMock.mockReset();
    parseJsonBodyMock.mockResolvedValue({});
    listConfiguredChannelAccountsMock.mockReturnValue({});
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {},
    });
  });

  afterAll(() => {
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
  });

  it('reports healthy running multi-account channels as connected', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default', 'feishu-2412524e'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      channelAccountOwners: {
        'feishu:default': 'main',
        'feishu:feishu-2412524e': 'code',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        feishu: {
          configured: true,
        },
      },
      channelAccounts: {
        feishu: [
          {
            accountId: 'default',
            configured: true,
            connected: false,
            running: true,
            linked: false,
          },
          {
            accountId: 'feishu-2412524e',
            configured: true,
            connected: false,
            running: true,
            linked: false,
          },
        ],
      },
      channelDefaultAccountId: {
        feishu: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          getDiagnostics: () => ({ consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('channels.status', { probe: false }, 8000);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'feishu',
            status: 'connected',
            accounts: expect.arrayContaining([
              expect.objectContaining({ accountId: 'default', status: 'connected' }),
              expect.objectContaining({ accountId: 'feishu-2412524e', status: 'connected' }),
            ]),
          }),
        ],
      }),
    );
  });

  it('rejects non-canonical account ID on channel config save', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: '测试账号',
      config: { appId: 'cli_xxx', appSecret: 'secret' },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/config'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
    expect(saveChannelConfigMock).not.toHaveBeenCalled();
  });

  it('allows legacy non-canonical account ID on channel config save when account already exists', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'Legacy_Account',
      config: { botToken: 'token', allowedUsers: '123456' },
    });
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'Legacy_Account'],
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/config'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'telegram',
      { botToken: 'token', allowedUsers: '123456' },
      'Legacy_Account',
    );
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({ success: true }),
    );
  });

  it('rejects non-canonical account ID on default-account route', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'ABC',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/default-account'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
    expect(setChannelDefaultAccountMock).not.toHaveBeenCalled();
  });

  it('rejects non-canonical account ID on binding routes', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'Account-Upper',
      agentId: 'main',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Invalid accountId format'),
      }),
    );
    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalled();

    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'INVALID VALUE',
    });
    await handleChannelRoutes(
      { method: 'DELETE' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );
    expect(clearChannelBindingMock).not.toHaveBeenCalled();
  });

  it('allows legacy non-canonical account ID on default-account and binding routes', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default', 'Legacy_Account'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main Agent' }],
      channelOwners: {},
      channelAccountOwners: {},
    });

    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'Legacy_Account',
    });
    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/default-account'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );
    expect(setChannelDefaultAccountMock).toHaveBeenCalledWith('feishu', 'Legacy_Account');

    parseJsonBodyMock.mockResolvedValue({
      channelType: 'feishu',
      accountId: 'Legacy_Account',
      agentId: 'main',
    });
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'feishu', 'Legacy_Account');
  });

  it('migrates legacy channel-wide fallback before manually binding a non-default account', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }, { id: 'code', name: 'Code Agent' }],
      channelOwners: { telegram: 'main' },
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'main', match: { channel: 'telegram' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      agentId: 'code',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(1, 'main', 'telegram', 'default');
    expect(clearChannelBindingMock).toHaveBeenCalledWith('telegram');
    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(2, 'code', 'telegram', 'telegram-a1b2c3d4');
  });

  it('does not synthesize a default binding when no legacy channel-wide binding exists', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }, { id: 'code', name: 'Code Agent' }],
      channelOwners: { telegram: 'code' },
      channelAccountOwners: {
        'telegram:telegram-a1b2c3d4': 'code',
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'code', match: { channel: 'telegram', accountId: 'telegram-a1b2c3d4' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-b2c3d4e5',
      agentId: 'code',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(clearChannelBindingMock).not.toHaveBeenCalled();
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledTimes(1);
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('code', 'telegram', 'telegram-b2c3d4e5');
  });

  it('preserves mixed-case agent ids when migrating a legacy channel-wide binding', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'MainAgent', name: 'Main Agent' }, { id: 'code', name: 'Code Agent' }],
      channelOwners: { telegram: 'mainagent' },
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'MainAgent', match: { channel: 'telegram' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      agentId: 'code',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(1, 'MainAgent', 'telegram', 'default');
    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(2, 'code', 'telegram', 'telegram-a1b2c3d4');
  });

  it('does not mutate legacy bindings when the requested agent does not exist', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main Agent' }],
      channelOwners: { telegram: 'main' },
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'main', match: { channel: 'telegram' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      agentId: 'missing-agent',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(clearChannelBindingMock).not.toHaveBeenCalled();
    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Agent "missing-agent" not found'),
      }),
    );
  });

  it('rejects binding requests without accountId before legacy migration runs', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main Agent' }],
      channelOwners: {},
      channelAccountOwners: {},
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      agentId: 'main',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(clearChannelBindingMock).not.toHaveBeenCalled();
    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: 'accountId is required',
      }),
    );
  });

  it('falls back to the legacy owner when explicit default owner is stale', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'MainAgent', name: 'Main Agent' }, { id: 'code', name: 'Code Agent' }],
      channelOwners: {},
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'MissingAgent', match: { channel: 'telegram', accountId: 'default' } },
        { agentId: 'MainAgent', match: { channel: 'telegram' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      agentId: 'code',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(1, 'MainAgent', 'telegram', 'default');
    expect(assignChannelAccountToAgentMock).toHaveBeenNthCalledWith(2, 'code', 'telegram', 'telegram-a1b2c3d4');
  });

  it('skips default binding migration when both explicit and legacy owners are stale', async () => {
    listConfiguredChannelAccountsMock.mockReturnValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-a1b2c3d4'],
      },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'code', name: 'Code Agent' }],
      channelOwners: {},
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'MissingDefault', match: { channel: 'telegram', accountId: 'default' } },
        { agentId: 'MissingLegacy', match: { channel: 'telegram' } },
      ],
    });
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      agentId: 'code',
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/binding'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(clearChannelBindingMock).toHaveBeenCalledWith('telegram');
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledTimes(1);
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('code', 'telegram', 'telegram-a1b2c3d4');
  });

  it('converts legacy channel-wide fallback into an explicit default binding when saving a non-default account', async () => {
    parseJsonBodyMock.mockResolvedValue({
      channelType: 'telegram',
      accountId: 'telegram-a1b2c3d4',
      config: { botToken: 'token', allowedUsers: '123456' },
    });
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      channelOwners: { telegram: 'main' },
      channelAccountOwners: {},
    });
    readOpenClawConfigMock.mockResolvedValue({
      bindings: [
        { agentId: 'main', match: { channel: 'telegram' } },
      ],
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/config'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'telegram',
      { botToken: 'token', allowedUsers: '123456' },
      'telegram-a1b2c3d4',
    );
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'telegram', 'default');
    expect(clearChannelBindingMock).toHaveBeenCalledWith('telegram');
    expect(assignChannelAccountToAgentMock).not.toHaveBeenCalledWith('main', 'telegram', 'telegram-a1b2c3d4');
  });

  it('keeps channel connected when one account is healthy and another errors', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['telegram']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      telegram: {
        defaultAccountId: 'default',
        accountIds: ['default', 'telegram-b'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          defaultAccount: 'default',
        },
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        telegram: {
          configured: true,
        },
      },
      channelAccounts: {
        telegram: [
          {
            accountId: 'default',
            configured: true,
            connected: true,
            running: true,
            linked: false,
          },
          {
            accountId: 'telegram-b',
            configured: true,
            connected: false,
            running: false,
            linked: false,
            lastError: 'secondary bot failed',
          },
        ],
      },
      channelDefaultAccountId: {
        telegram: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'telegram',
            status: 'connected',
            accounts: expect.arrayContaining([
              expect.objectContaining({ accountId: 'default', status: 'connected' }),
              expect.objectContaining({ accountId: 'telegram-b', status: 'error' }),
            ]),
          }),
        ],
      }),
    );
  });

  it('filters runtime-only stale accounts when not configured locally', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        feishu: {
          configured: true,
        },
      },
      channelAccounts: {
        feishu: [
          {
            accountId: 'default',
            configured: true,
            connected: true,
            running: true,
          },
          {
            accountId: '2',
            configured: false,
            connected: false,
            running: false,
            lastError: 'stale runtime session',
          },
        ],
      },
      channelDefaultAccountId: {
        feishu: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'feishu',
            accounts: [expect.objectContaining({ accountId: 'default' })],
          }),
        ],
      }),
    );
    const payload = sendJsonMock.mock.calls.at(-1)?.[2] as {
      channels?: Array<{ channelType: string; accounts: Array<{ accountId: string }> }>;
    };
    const feishu = payload.channels?.find((entry) => entry.channelType === 'feishu');
    expect(feishu?.accounts.map((entry) => entry.accountId)).toEqual(['default']);
  });

  it('returns degraded channel health when channels.status times out while gateway is still running', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });

    const rpc = vi.fn().mockRejectedValue(new Error('RPC timeout: channels.status'));

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          getDiagnostics: () => ({ consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        gatewayHealth: expect.objectContaining({
          state: 'degraded',
          reasons: expect.arrayContaining(['channels_status_timeout']),
        }),
        channels: [
          expect.objectContaining({
            channelType: 'feishu',
            status: 'degraded',
            statusReason: 'channels_status_timeout',
            accounts: [
              expect.objectContaining({
                accountId: 'default',
                status: 'degraded',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('keeps channel degraded when only filtered stale runtime accounts carry lastError', async () => {
    listConfiguredChannelsMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsMock.mockResolvedValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default'],
      },
    });
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      channels: {
        feishu: {
          configured: true,
        },
      },
      channelAccounts: {
        feishu: [
          {
            accountId: 'default',
            configured: true,
            connected: true,
            running: true,
            linked: false,
          },
          {
            accountId: '2',
            configured: false,
            connected: false,
            running: false,
            lastError: 'stale runtime session',
          },
        ],
      },
      channelDefaultAccountId: {
        feishu: 'default',
      },
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/accounts'),
      {
        gatewayManager: {
          rpc,
          getStatus: () => ({ state: 'running' }),
          getDiagnostics: () => ({ consecutiveHeartbeatMisses: 1, consecutiveRpcFailures: 0 }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channels: [
          expect.objectContaining({
            channelType: 'feishu',
            status: 'degraded',
            accounts: [
              expect.objectContaining({ accountId: 'default', status: 'degraded' }),
            ],
          }),
        ],
      }),
    );
  });

  it('lists known QQ Bot targets for a configured account', async () => {
    const knownUsersPath = join(testOpenClawConfigDir, 'qqbot', 'data');
    mkdirSync(knownUsersPath, { recursive: true });
    writeFileSync(join(knownUsersPath, 'known-users.json'), JSON.stringify([
      {
        openid: '207A5B8339D01F6582911C014668B77B',
        type: 'c2c',
        nickname: 'Alice',
        accountId: 'default',
        lastSeenAt: 200,
      },
      {
        openid: 'member-openid',
        type: 'group',
        nickname: 'Weather Group',
        groupOpenid: 'GROUP_OPENID_123',
        accountId: 'default',
        lastSeenAt: 100,
      },
    ]), 'utf8');

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/targets?channelType=qqbot&accountId=default'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channelType: 'qqbot',
        accountId: 'default',
        targets: [
          expect.objectContaining({
            value: 'qqbot:c2c:207A5B8339D01F6582911C014668B77B',
            kind: 'user',
          }),
          expect.objectContaining({
            value: 'qqbot:group:GROUP_OPENID_123',
            kind: 'group',
          }),
        ],
      }),
    );
  });

  it('lists Feishu targets for a configured account', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          appId: 'cli_app_id',
          appSecret: 'cli_app_secret',
          allowFrom: ['ou_config_user'],
          groups: {
            oc_config_group: {},
          },
        },
      },
    });

    proxyAwareFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/tenant_access_token/internal')) {
        const body = JSON.parse(String(init?.body || '{}')) as { app_id?: string };
        if (body.app_id === 'cli_app_id') {
          return {
            ok: true,
            json: async () => ({
              code: 0,
              tenant_access_token: 'tenant-token',
            }),
          };
        }
      }

      if (url.includes('/applications/cli_app_id')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              app: {
                creator_id: 'ou_owner',
                owner: {
                  owner_type: 2,
                  owner_id: 'ou_owner',
                },
              },
            },
          }),
        };
      }

      if (url.includes('/contact/v3/users')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              items: [
                { open_id: 'ou_live_user', name: 'Alice Feishu' },
              ],
            },
          }),
        };
      }

      if (url.includes('/im/v1/chats')) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              items: [
                { chat_id: 'oc_live_chat', name: 'Project Chat' },
              ],
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/targets?channelType=feishu&accountId=default'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channelType: 'feishu',
        accountId: 'default',
        targets: expect.arrayContaining([
          expect.objectContaining({ value: 'user:ou_owner', kind: 'user' }),
          expect.objectContaining({ value: 'user:ou_live_user', kind: 'user' }),
          expect.objectContaining({ value: 'chat:oc_live_chat', kind: 'group' }),
        ]),
      }),
    );
  });

  it('lists WeCom targets from reqid cache and session history', async () => {
    mkdirSync(join(testOpenClawConfigDir, 'wecom'), { recursive: true });
    writeFileSync(
      join(testOpenClawConfigDir, 'wecom', 'reqid-map-default.json'),
      JSON.stringify({
        'chat-alpha': { reqId: 'req-1', ts: 100 },
      }),
      'utf8',
    );
    mkdirSync(join(testOpenClawConfigDir, 'agents', 'main', 'sessions'), { recursive: true });
    writeFileSync(
      join(testOpenClawConfigDir, 'agents', 'main', 'sessions', 'sessions.json'),
      JSON.stringify({
        'agent:main:wecom:chat-bravo': {
          updatedAt: 200,
          chatType: 'group',
          displayName: 'Ops Group',
          deliveryContext: {
            channel: 'wecom',
            accountId: 'default',
            to: 'wecom:chat-bravo',
          },
        },
      }),
      'utf8',
    );

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/targets?channelType=wecom&accountId=default'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channelType: 'wecom',
        accountId: 'default',
        targets: expect.arrayContaining([
          expect.objectContaining({ value: 'wecom:chat-bravo', kind: 'group' }),
          expect.objectContaining({ value: 'wecom:chat-alpha', kind: 'channel' }),
        ]),
      }),
    );
  });

  it('lists DingTalk targets from session history', async () => {
    mkdirSync(join(testOpenClawConfigDir, 'agents', 'main', 'sessions'), { recursive: true });
    writeFileSync(
      join(testOpenClawConfigDir, 'agents', 'main', 'sessions', 'sessions.json'),
      JSON.stringify({
        'agent:main:dingtalk:cid-group': {
          updatedAt: 300,
          chatType: 'group',
          displayName: 'DingTalk Dev Group',
          deliveryContext: {
            channel: 'dingtalk',
            accountId: 'default',
            to: 'cidDeVGroup=',
          },
        },
      }),
      'utf8',
    );

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/targets?channelType=dingtalk&accountId=default'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channelType: 'dingtalk',
        accountId: 'default',
        targets: [
          expect.objectContaining({
            value: 'cidDeVGroup=',
            kind: 'group',
          }),
        ],
      }),
    );
  });

  it('lists WeChat targets from session history via the UI alias', async () => {
    mkdirSync(join(testOpenClawConfigDir, 'agents', 'main', 'sessions'), { recursive: true });
    writeFileSync(
      join(testOpenClawConfigDir, 'agents', 'main', 'sessions', 'sessions.json'),
      JSON.stringify({
        'agent:main:wechat:wxid_target': {
          updatedAt: 400,
          chatType: 'direct',
          displayName: 'Alice WeChat',
          deliveryContext: {
            channel: 'openclaw-weixin',
            accountId: 'wechat-bot',
            to: 'wechat:wxid_target',
          },
        },
      }),
      'utf8',
    );

    const { handleChannelRoutes } = await import('@electron/api/routes/channels');
    const handled = await handleChannelRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/channels/targets?channelType=wechat&accountId=wechat-bot'),
      {
        gatewayManager: {
          rpc: vi.fn(),
          getStatus: () => ({ state: 'running' }),
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        success: true,
        channelType: 'wechat',
        accountId: 'wechat-bot',
        targets: [
          expect.objectContaining({
            value: 'wechat:wxid_target',
            kind: 'user',
          }),
        ],
      }),
    );
  });
});

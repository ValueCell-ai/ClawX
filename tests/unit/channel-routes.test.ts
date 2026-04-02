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
const testOpenClawConfigDir = join(tmpdir(), 'clawx-tests', 'channel-routes-openclaw');

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  deleteChannelAccountConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
  getChannelFormValues: vi.fn(),
  listConfiguredChannelAccounts: (...args: unknown[]) => listConfiguredChannelAccountsMock(...args),
  listConfiguredChannels: (...args: unknown[]) => listConfiguredChannelsMock(...args),
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
  saveChannelConfig: vi.fn(),
  setChannelDefaultAccount: vi.fn(),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(),
  validateChannelCredentials: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: vi.fn(),
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: vi.fn(),
  listAgentsSnapshot: (...args: unknown[]) => listAgentsSnapshotMock(...args),
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
  parseJsonBody: vi.fn().mockResolvedValue({}),
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
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
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
          debouncedReload: vi.fn(),
          debouncedRestart: vi.fn(),
        },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('channels.status', { probe: true });
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

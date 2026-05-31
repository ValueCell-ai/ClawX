import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Channels } from '@/pages/Channels/index';

const hostApiCallMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agents: {
      list: () => hostApiCallMock('agents.list'),
    },
    channels: {
      accounts: (options?: { mode?: string; probe?: boolean }) => hostApiCallMock('channels.accounts', options),
      formValues: (channelType: string, accountId?: string) => {
        return hostApiCallMock('channels.formValues', { channelType, accountId });
      },
      saveConfig: (input: unknown) => hostApiCallMock('channels.saveConfig', input),
      deleteConfig: (channelType: string, accountId?: string) => {
        return hostApiCallMock('channels.deleteConfig', { channelType, accountId });
      },
      validateCredentials: (channelType: string, config: Record<string, unknown>) => (
        hostApiCallMock('channels.validateCredentials', { channelType, config })
      ),
      saveBinding: (input: unknown) => hostApiCallMock('channels.saveBinding', input),
      deleteBinding: (input: unknown) => hostApiCallMock('channels.deleteBinding', input),
      startLogin: (channelType: string, input?: unknown) => hostApiCallMock('channels.startLogin', { channelType, input }),
      cancelLogin: (channelType: string, input?: unknown) => hostApiCallMock('channels.cancelLogin', { channelType, input }),
    },
    diagnostics: {
      gatewaySnapshot: () => hostApiCallMock('diagnostics.gatewaySnapshot'),
    },
    gateway: {
      restart: () => hostApiCallMock('gateway.restart', { method: 'POST' }),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayChannelStatus: (handler: unknown) => subscribeHostEventMock('gateway:channel-status', handler),
    onChannelQr: (channel: string, handler: unknown) => subscribeHostEventMock(`channel:${channel}-qr`, handler),
    onChannelSuccess: (channel: string, handler: unknown) => subscribeHostEventMock(`channel:${channel}-success`, handler),
    onChannelError: (channel: string, handler: unknown) => subscribeHostEventMock(`channel:${channel}-error`, handler),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Channels page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: vi.fn(),
      },
      configurable: true,
    });
    gatewayState.status = { state: 'running', port: 18789 };
    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'healthy',
            reasons: [],
            consecutiveHeartbeatMisses: 0,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'connected',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }

      if (path === 'agents.list') {
        return {
          success: true,
          agents: [],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });
  });

  it('blocks saving when custom account ID is non-canonical', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'connected',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }

      if (path === 'agents.list') {
        return {
          success: true,
          agents: [],
        };
      }

      if (path === 'channels.validateCredentials') {
        return {
          success: true,
          valid: true,
          warnings: [],
        };
      }

      if (path === 'channels.saveConfig') {
        return {
          success: true,
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('Feishu / Lark')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'account.add' }));

    await waitFor(() => {
      expect(screen.getByText('dialog.configureTitle')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('account.customIdLabel'), {
      target: { value: '测试账号' },
    });
    const appIdInput = document.getElementById('appId') as HTMLInputElement | null;
    const appSecretInput = document.getElementById('appSecret') as HTMLInputElement | null;
    expect(appIdInput).not.toBeNull();
    expect(appSecretInput).not.toBeNull();
    fireEvent.change(appIdInput!, { target: { value: 'cli_test' } });
    fireEvent.change(appSecretInput!, { target: { value: 'secret_test' } });

    fireEvent.click(screen.getByRole('button', { name: 'dialog.saveAndConnect' }));

    await waitFor(() => {
      expect(screen.getByText('account.invalidCanonicalId')).toBeInTheDocument();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('account.invalidCanonicalId');

    const saveCalls = hostApiCallMock.mock.calls.filter(([path]) => path === 'channels.saveConfig');
    expect(saveCalls).toHaveLength(0);
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Channels />);

    await waitFor(() => {
      expect(hostApiCallMock).toHaveBeenCalledWith('channels.accounts', expect.objectContaining({ mode: 'runtime' }));
      expect(hostApiCallMock).toHaveBeenCalledWith('agents.list');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiCallMock.mock.calls.filter(([path, options]) => (
        path === 'channels.accounts' && (options as { mode?: string } | undefined)?.mode !== 'config'
      ));
      const agentFetchCalls = hostApiCallMock.mock.calls.filter(([path]) => path === 'agents.list');
      expect(channelFetchCalls).toHaveLength(2);
      expect(agentFetchCalls).toHaveLength(1);
    });
  });

  it('refetches when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Channels />);

    await waitFor(() => {
      expect(hostApiCallMock).toHaveBeenCalledWith('channels.accounts', expect.objectContaining({ mode: 'runtime' }));
      expect(hostApiCallMock).toHaveBeenCalledWith('agents.list');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Channels />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiCallMock.mock.calls.filter(([path, options]) => (
        path === 'channels.accounts' && (options as { mode?: string } | undefined)?.mode !== 'config'
      ));
      const agentFetchCalls = hostApiCallMock.mock.calls.filter(([path]) => path === 'agents.list');
      expect(channelFetchCalls).toHaveLength(2);
      expect(agentFetchCalls).toHaveLength(1);
    });
  });

  it('renders channel data without waiting for slow agents request', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    const agentsDeferred = createDeferred<{
      success: boolean;
      agents: Array<Record<string, unknown>>;
    }>();

    hostApiCallMock.mockImplementation((path: string) => {
      if (path === 'channels.accounts') {
        return Promise.resolve({
          success: true,
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'connected',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          ],
        });
      }
      if (path === 'agents.list') {
        return agentsDeferred.promise;
      }
      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    expect(await screen.findByText('Feishu / Lark')).toBeInTheDocument();

    await act(async () => {
      agentsDeferred.resolve({ success: true, agents: [] });
    });
  });

  it('treats WeChat accounts as plugin-managed QR accounts', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          channels: [
            {
              channelType: 'wechat',
              defaultAccountId: 'wx-bot-im-bot',
              status: 'connected',
              accounts: [
                {
                  accountId: 'wx-bot-im-bot',
                  name: 'WeChat ClawBot',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }

      if (path === 'agents.list') {
        return {
          success: true,
          agents: [],
        };
      }

      if (path === 'channels.cancelLogin') {
        return { success: true };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('WeChat')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'account.add' }));

    await waitFor(() => {
      expect(screen.getByText('dialog.configureTitle')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('account.customIdLabel')).not.toBeInTheDocument();
  });

  it('keeps the last channel snapshot visible while refresh is pending', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    const channelsDeferred = createDeferred<{
      success: boolean;
      channels: Array<Record<string, unknown>>;
    }>();
    const agentsDeferred = createDeferred<{
      success: boolean;
      agents: Array<Record<string, unknown>>;
    }>();

    let refreshCallCount = 0;
    hostApiCallMock.mockImplementation((path: string) => {
      if (path === 'channels.accounts') {
        if (refreshCallCount === 0) {
          refreshCallCount += 1;
          return Promise.resolve({
            success: true,
            channels: [
              {
                channelType: 'feishu',
                defaultAccountId: 'default',
                status: 'connected',
                accounts: [
                  {
                    accountId: 'default',
                    name: 'Primary Account',
                    configured: true,
                    status: 'connected',
                    isDefault: true,
                  },
                ],
              },
            ],
          });
        }
        return channelsDeferred.promise;
      }

      if (path === 'agents.list') {
        if (refreshCallCount === 1) {
          return Promise.resolve({ success: true, agents: [] });
        }
        return agentsDeferred.promise;
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    expect(await screen.findByText('Feishu / Lark')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(screen.getByText('Feishu / Lark')).toBeInTheDocument();

    await act(async () => {
      channelsDeferred.resolve({
        success: true,
        channels: [
          {
            channelType: 'feishu',
            defaultAccountId: 'default',
            status: 'connected',
            accounts: [
              {
                accountId: 'default',
                name: 'Primary Account',
                configured: true,
                status: 'connected',
                isDefault: true,
              },
            ],
          },
        ],
      });
      agentsDeferred.resolve({ success: true, agents: [] });
    });
  });

  it('keeps filled Feishu credentials when account ID is edited', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    render(<Channels />);

    await waitFor(() => {
      expect(screen.getByText('Feishu / Lark')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'account.add' }));

    const appIdInput = await screen.findByPlaceholderText('channels:meta.feishu.fields.appId.placeholder');
    const appSecretInput = screen.getByPlaceholderText('channels:meta.feishu.fields.appSecret.placeholder');
    const accountIdInput = screen.getByLabelText('account.customIdLabel');

    fireEvent.change(appIdInput, { target: { value: 'cli_test_app' } });
    fireEvent.change(appSecretInput, { target: { value: 'secret_test_value' } });
    fireEvent.change(accountIdInput, { target: { value: 'feishu-renamed-account' } });

    expect(appIdInput).toHaveValue('cli_test_app');
    expect(appSecretInput).toHaveValue('secret_test_value');
  });

  it('shows degraded gateway banner and copies diagnostics snapshot', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    const writeTextMock = vi.mocked(navigator.clipboard.writeText);

    hostApiCallMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'degraded',
              statusReason: 'channels_status_timeout',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'degraded',
                  statusReason: 'channels_status_timeout',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }

      if (path === 'agents.list') {
        return {
          success: true,
          agents: [],
        };
      }

      if (path === 'diagnostics.gatewaySnapshot') {
        return {
          capturedAt: 123,
          platform: 'darwin',
          gateway: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [],
          clawxLogTail: 'clawx',
          gatewayLogTail: 'gateway',
          gatewayErrLogTail: '',
        };
      }

      if (path === 'gateway.restart' && init?.method === 'POST') {
        return { success: true };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    expect(await screen.findByTestId('channels-health-banner')).toBeInTheDocument();
    expect(screen.getByText('health.state.degraded')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('channels-copy-diagnostics'));

    await waitFor(() => {
      expect(hostApiCallMock).toHaveBeenCalledWith('diagnostics.gatewaySnapshot');
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('"platform": "darwin"'));
    });
  });

  it('suppresses stale gateway-not-running health while gateway status is running', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'degraded',
            reasons: ['gateway_not_running'],
            consecutiveHeartbeatMisses: 0,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'connected',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'connected',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }

      if (path === 'agents.list') {
        return { success: true, agents: [] };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    expect(await screen.findByText('Feishu / Lark')).toBeInTheDocument();
    expect(screen.queryByTestId('channels-health-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('health.reasons.gateway_not_running')).not.toBeInTheDocument();
  });

  it('surfaces diagnostics fetch failure payloads instead of caching them as snapshots', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'degraded',
              statusReason: 'channels_status_timeout',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'degraded',
                  statusReason: 'channels_status_timeout',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }
      if (path === 'agents.list') {
        return { success: true, agents: [] };
      }
      if (path === 'diagnostics.gatewaySnapshot') {
        return { success: false, error: 'snapshot failed' };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);
    expect(await screen.findByTestId('channels-health-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('channels-toggle-diagnostics'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('health.diagnosticsCopyFailed');
    });
    expect(screen.queryByTestId('channels-diagnostics')).not.toBeInTheDocument();
  });

  it('shows restart failure when gateway restart returns success=false', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    hostApiCallMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'degraded',
              statusReason: 'channels_status_timeout',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'degraded',
                  statusReason: 'channels_status_timeout',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }
      if (path === 'agents.list') {
        return { success: true, agents: [] };
      }
      if (path === 'gateway.restart' && init?.method === 'POST') {
        return { success: false, error: 'restart failed' };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);
    expect(await screen.findByTestId('channels-health-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('channels-restart-gateway'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('health.restartFailed');
    });
    expect(toastSuccessMock).not.toHaveBeenCalledWith('health.restartTriggered');
  });

  it('refetches diagnostics snapshot every time the diagnostics panel is reopened', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());

    let diagnosticsFetchCount = 0;
    hostApiCallMock.mockImplementation(async (path: string) => {
      if (path === 'channels.accounts') {
        return {
          success: true,
          gatewayHealth: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [
            {
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'degraded',
              statusReason: 'channels_status_timeout',
              accounts: [
                {
                  accountId: 'default',
                  name: 'Primary Account',
                  configured: true,
                  status: 'degraded',
                  statusReason: 'channels_status_timeout',
                  isDefault: true,
                },
              ],
            },
          ],
        };
      }
      if (path === 'agents.list') {
        return { success: true, agents: [] };
      }
      if (path === 'diagnostics.gatewaySnapshot') {
        diagnosticsFetchCount += 1;
        return {
          capturedAt: diagnosticsFetchCount,
          platform: 'darwin',
          gateway: {
            state: 'degraded',
            reasons: ['channels_status_timeout'],
            consecutiveHeartbeatMisses: 1,
          },
          channels: [],
          clawxLogTail: `clawx-${diagnosticsFetchCount}`,
          gatewayLogTail: 'gateway',
          gatewayErrLogTail: '',
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });

    render(<Channels />);

    expect(await screen.findByTestId('channels-health-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('channels-toggle-diagnostics'));
    await waitFor(() => {
      expect(screen.getByTestId('channels-diagnostics')).toHaveTextContent('"capturedAt": 1');
    });

    fireEvent.click(screen.getByTestId('channels-toggle-diagnostics'));
    expect(screen.queryByTestId('channels-diagnostics')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('channels-toggle-diagnostics'));
    await waitFor(() => {
      expect(screen.getByTestId('channels-diagnostics')).toHaveTextContent('"capturedAt": 2');
    });

    expect(diagnosticsFetchCount).toBe(2);
  });
});

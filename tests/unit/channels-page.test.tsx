import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Channels } from '@/pages/Channels/index';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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
    gatewayState.status = { state: 'running', port: 18789 };
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
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

      if (path === '/api/agents') {
        return {
          success: true,
          agents: [],
        };
      }

      throw new Error(`Unexpected host API path: ${path}`);
    });
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
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      const agentFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/agents');
      expect(channelFetchCalls).toHaveLength(2);
      expect(agentFetchCalls).toHaveLength(2);
    });
  });

  it('refetches when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Channels />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Channels />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      const agentFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/agents');
      expect(channelFetchCalls).toHaveLength(2);
      expect(agentFetchCalls).toHaveLength(2);
    });
  });

  it('treats WeChat accounts as plugin-managed QR accounts', async () => {
    subscribeHostEventMock.mockImplementation(() => vi.fn());
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/channels/accounts') {
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

      if (path === '/api/agents') {
        return {
          success: true,
          agents: [],
        };
      }

      if (path === '/api/channels/wechat/cancel') {
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
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/channels/accounts') {
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

      if (path === '/api/agents') {
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
});

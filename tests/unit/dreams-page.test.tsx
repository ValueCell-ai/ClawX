import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Dreams } from '@/pages/Dreams';

const rpcMock = vi.fn();
const hostApiFetchMock = vi.fn();
const tMock = (key: string) => key;

const { gatewayState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as {
      state: string;
      port: number;
      gatewayReady?: boolean;
    },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState & { rpc: typeof rpcMock }) => unknown) => selector({
    ...gatewayState,
    rpc: rpcMock,
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tMock,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Dreams page gateway readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    rpcMock.mockImplementation(async (method: string) => {
      if (method === 'doctor.memory.status') {
        return {
          dreaming: {
            enabled: true,
            shortTermCount: 1,
            groundedSignalCount: 0,
            totalSignalCount: 1,
            promotedToday: 0,
            shortTermEntries: [],
            promotedEntries: [],
          },
        };
      }
      if (method === 'doctor.memory.dreamDiary') {
        return { found: true, content: '' };
      }
      return {};
    });
  });

  it('does not call memory doctor RPCs until gatewayReady is true', async () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    const { rerender } = render(<Dreams />);

    expect(screen.getByTestId('dreams-refresh')).toBeDisabled();
    expect(screen.getByTestId('dreams-enable')).toBeDisabled();
    expect(screen.getByText('gatewayNotReady')).toBeVisible();
    await waitFor(() => {
      expect(rpcMock).not.toHaveBeenCalled();
    });

    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    await act(async () => {
      rerender(<Dreams />);
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('doctor.memory.status', {}, 12_000);
      expect(rpcMock).toHaveBeenCalledWith('doctor.memory.dreamDiary', {}, 12_000);
    });
    expect(screen.getByTestId('dreams-refresh')).toBeEnabled();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Models } from '@/pages/Models/index';

const hostApiFetchMock = vi.fn();
const trackUiEventMock = vi.fn();

const { gatewayState, settingsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, connectedAt: 1, pid: 1234 },
  },
  settingsState: {
    devModeUnlocked: false,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    usage: {
      recentTokenHistory: () => hostApiFetchMock('/api/usage/recent-token-history'),
    },
  },
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: (...args: unknown[]) => trackUiEventMock(...args),
}));

vi.mock('@/components/settings/ProvidersSettings', () => ({
  ProvidersSettings: () => <div data-testid="providers-settings-panel" />,
}));

vi.mock('@/components/settings/ImageGenerationSettings', () => ({
  ImageGenerationSettings: () => <div data-testid="image-generation-settings-panel" />,
}));

vi.mock('@/components/common/FeedbackState', () => ({
  FeedbackState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count?: number }) => {
      if (typeof fallback === 'string') return fallback;
      return key;
    },
  }),
}));

function createUsageEntry(totalTokens: number) {
  return {
    timestamp: '2026-04-01T12:00:00.000Z',
    sessionId: `session-${totalTokens}`,
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  };
}

function renderModels(initialEntry = '/models') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Models />
    </MemoryRouter>,
  );
}

describe('Models page auto refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    settingsState.devModeUnlocked = false;
    gatewayState.status = { state: 'running', port: 18789, connectedAt: 1, pid: 1234 };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    hostApiFetchMock.mockResolvedValue([createUsageEntry(27)]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes token usage while the page stays open', async () => {
    renderModels();

    await act(async () => {
      await Promise.resolve();
    });
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses a single chat panel when developer mode is locked and gates image settings', async () => {
    const { unmount } = renderModels();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('models-management-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('models-tab-chat')).not.toBeInTheDocument();
    expect(screen.getByTestId('providers-settings-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Token Usage History' })).toBeInTheDocument();
    expect(screen.queryByTestId('models-tab-image-generation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('models-tab-realtime-talk')).not.toBeInTheDocument();

    unmount();
    settingsState.devModeUnlocked = true;
    renderModels();

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.mouseDown(screen.getByTestId('models-tab-image-generation'), { button: 0 });
    expect(screen.getByTestId('image-generation-settings-panel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Token Usage History' })).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('models-tab-chat'), { button: 0 });
    expect(screen.getByRole('heading', { name: 'Token Usage History' })).toBeInTheDocument();
  });

  it('opens only an allowed Models tab from the tab query parameter', async () => {
    settingsState.devModeUnlocked = true;
    const { unmount } = renderModels('/models?tab=realtime-talk');

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('models-tab-chat')).toHaveAttribute('data-state', 'active');
    expect(screen.queryByTestId('models-tab-realtime-talk')).not.toBeInTheDocument();

    unmount();
    renderModels('/models?tab=unsupported');

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('models-tab-chat')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('providers-settings-panel')).toBeInTheDocument();
  });
});

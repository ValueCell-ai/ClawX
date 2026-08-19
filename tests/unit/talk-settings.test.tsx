import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { catalogMock, configPathMock, openPathMock, updateRealtimeSettingsMock } = vi.hoisted(() => ({
  catalogMock: vi.fn(),
  configPathMock: vi.fn(),
  openPathMock: vi.fn(),
  updateRealtimeSettingsMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    openclaw: {
      getConfigPath: (...args: unknown[]) => configPathMock(...args),
    },
    shell: {
      openPath: (...args: unknown[]) => openPathMock(...args),
    },
    talk: {
      catalog: (...args: unknown[]) => catalogMock(...args),
      updateRealtimeSettings: (...args: unknown[]) => updateRealtimeSettingsMock(...args),
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { TalkSettings } from '@/components/settings/TalkSettings';

const catalog = {
  realtime: {
    ready: false,
    reason: 'Configure a realtime provider',
    activeProvider: 'openai',
    providers: [{
      id: 'openai',
      label: 'OpenAI',
      configured: true,
      models: ['gpt-realtime', 'gpt-realtime-mini'],
      voices: ['alloy', 'verse'],
    }, {
      id: 'unavailable',
      label: 'Unavailable',
      configured: false,
      models: ['private-model'],
      voices: ['private-voice'],
    }],
  },
};

describe('TalkSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogMock.mockResolvedValue(catalog);
    configPathMock.mockResolvedValue('/tmp/openclaw.json');
    openPathMock.mockResolvedValue('');
    updateRealtimeSettingsMock.mockResolvedValue({ ok: true });
  });

  it('shows all catalog providers and refreshes after saving a configured selection', async () => {
    render(<TalkSettings />);

    await waitFor(() => expect(screen.getByTestId('talk-settings-provider')).toHaveValue('openai'));
    expect(screen.getByTestId('talk-settings-provider')).toContainHTML('OpenAI');
    expect(screen.getByTestId('talk-settings-provider')).toContainHTML('Unavailable');
    expect(screen.getByRole('option', { name: /Unavailable/ })).toBeDisabled();
    expect(screen.getByTestId('talk-settings-model')).toContainHTML('gpt-realtime-mini');
    expect(screen.getByTestId('talk-settings-unavailable-reason')).toHaveTextContent('Configure a realtime provider');
    expect(screen.queryByText(/api key|transport|vad/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('talk-settings-model'), { target: { value: 'gpt-realtime-mini' } });
    fireEvent.click(screen.getByTestId('talk-settings-save'));

    await waitFor(() => expect(updateRealtimeSettingsMock).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-realtime-mini',
    }));
    await waitFor(() => expect(catalogMock).toHaveBeenCalledTimes(2));
  });

  it('uses defaultModel when the catalog does not declare a model list', async () => {
    catalogMock.mockResolvedValue({
      realtime: {
        ready: true,
        activeProvider: 'bundled',
        providers: [{
          id: 'bundled',
          label: 'Bundled provider',
          configured: true,
          defaultModel: 'bundled-realtime',
        }],
      },
    });
    render(<TalkSettings />);

    await waitFor(() => expect(screen.getByTestId('talk-settings-model')).toHaveValue('bundled-realtime'));
    fireEvent.click(screen.getByTestId('talk-settings-save'));

    await waitFor(() => expect(updateRealtimeSettingsMock).toHaveBeenCalledWith({
      provider: 'bundled',
      model: 'bundled-realtime',
    }));
  });

  it('opens the resolved OpenClaw config path', async () => {
    render(<TalkSettings />);

    await waitFor(() => expect(screen.getByTestId('talk-settings-open-config')).toBeEnabled());
    fireEvent.click(screen.getByTestId('talk-settings-open-config'));
    await waitFor(() => expect(openPathMock).toHaveBeenCalledWith('/tmp/openclaw.json'));
  });
});

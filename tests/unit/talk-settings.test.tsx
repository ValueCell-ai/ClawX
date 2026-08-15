import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { catalogMock, updateRealtimeSettingsMock } = vi.hoisted(() => ({
  catalogMock: vi.fn(),
  updateRealtimeSettingsMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
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
    updateRealtimeSettingsMock.mockResolvedValue({ ok: true });
  });

  it('uses only configured catalog options and refreshes after saving a selection', async () => {
    render(<TalkSettings />);

    await waitFor(() => expect(screen.getByTestId('talk-settings-provider')).toHaveValue('openai'));
    expect(screen.getByTestId('talk-settings-provider')).toContainHTML('OpenAI');
    expect(screen.getByTestId('talk-settings-provider')).not.toContainHTML('Unavailable');
    expect(screen.getByTestId('talk-settings-model')).toContainHTML('gpt-realtime-mini');
    expect(screen.getByTestId('talk-settings-voice')).toContainHTML('verse');
    expect(screen.getByTestId('talk-settings-unavailable-reason')).toHaveTextContent('Configure a realtime provider');
    expect(screen.queryByText(/api key|transport|vad/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('talk-settings-model'), { target: { value: 'gpt-realtime-mini' } });
    fireEvent.change(screen.getByTestId('talk-settings-voice'), { target: { value: 'verse' } });
    fireEvent.click(screen.getByTestId('talk-settings-save'));

    await waitFor(() => expect(updateRealtimeSettingsMock).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-realtime-mini',
      speakerVoice: 'verse',
    }));
    await waitFor(() => expect(catalogMock).toHaveBeenCalledTimes(2));
  });

  it('uses defaultModel without rendering an empty voice selector when the catalog has no voice choices', async () => {
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
    expect(screen.queryByTestId('talk-settings-voice')).not.toBeInTheDocument();
    expect(screen.getByTestId('talk-settings-voice-unavailable')).toHaveTextContent('talk.voiceUnavailable');
    fireEvent.click(screen.getByTestId('talk-settings-save'));

    await waitFor(() => expect(updateRealtimeSettingsMock).toHaveBeenCalledWith({
      provider: 'bundled',
      model: 'bundled-realtime',
    }));
  });

  it('links developer guidance to the Developer settings anchor', async () => {
    render(<TalkSettings />);

    await waitFor(() => expect(screen.getByTestId('talk-settings-developer-link')).toHaveAttribute(
      'href',
      '#/settings?section=developer',
    ));
  });
});

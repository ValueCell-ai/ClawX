import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsrSettings } from '@/components/settings/AsrSettings';
import { ASR_PRESET_DEFAULTS } from '@shared/asr/presets';
import type { AsrConfigResult } from '@shared/host-api/contract';

const getConfigMock = vi.hoisted(() => vi.fn());
const saveConfigMock = vi.hoisted(() => vi.fn());
const openExternalMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    asr: {
      getConfig: getConfigMock,
      saveConfig: saveConfigMock,
    },
    shell: {
      openExternal: openExternalMock,
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

function translate(key: string, options?: { defaultValue?: string }): string {
  switch (key) {
    case 'settings:asr.title':
      return 'Speech-to-text';
    case 'settings:asr.presets.label':
      return 'Provider';
    case 'settings:asr.presets.openai':
      return 'OpenAI';
    case 'settings:asr.presets.groq':
      return 'Groq';
    case 'settings:asr.presets.siliconflow':
      return 'SiliconFlow';
    case 'settings:asr.presets.custom':
      return 'Custom';
    case 'settings:asr.baseUrl':
      return 'API base URL';
    case 'settings:asr.model':
      return 'Model';
    case 'settings:asr.language':
      return 'Language';
    case 'settings:asr.languageAuto':
      return 'Auto-detect (recommended)';
    case 'settings:asr.apiKey':
      return 'API key';
    case 'settings:asr.apiKeyConfiguredPlaceholder':
      return 'An API key is already configured for this provider. Leave blank to keep it.';
    case 'settings:asr.apiKeyLink':
      return 'Get API key';
    case 'settings:asr.apiKeyLinkTitle':
      return 'Open the provider console to get an API key';
    case 'settings:asr.save':
      return 'Save';
    case 'settings:asr.toast.saved':
      return 'Speech-to-text settings saved.';
    case 'settings:asr.errors.invalidBaseUrl':
      return 'The base URL must start with http:// or https://.';
    case 'settings:asr.errors.modelRequired':
      return 'Enter a model name.';
    case 'settings:asr.errors.request':
      return 'Saving failed. Please try again.';
    default:
      return options && typeof options.defaultValue === 'string' ? options.defaultValue : key;
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
    i18n: { resolvedLanguage: 'en-US' },
  }),
}));

function configResult(overrides: Partial<AsrConfigResult> = {}): AsrConfigResult {
  return {
    configured: true,
    config: {
      preset: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3',
      language: 'en',
    },
    hasApiKey: true,
    ...overrides,
  };
}

function renderAsrSettings() {
  return render(<AsrSettings />);
}

describe('AsrSettings', () => {
  beforeEach(() => {
    getConfigMock.mockReset();
    saveConfigMock.mockReset();
    openExternalMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    saveConfigMock.mockResolvedValue(configResult());
  });

  it('loads the existing config into the inputs and masks the stored key', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();

    expect(await screen.findByTestId('asr-base-url-input')).toHaveValue('https://api.groq.com/openai/v1');
    expect(screen.getByText('Provider')).toHaveAttribute('for', 'asr-preset');
    expect(screen.getByTestId('asr-preset-select')).toHaveValue('groq');
    expect(screen.getByTestId('asr-model-input')).toHaveValue('whisper-large-v3');
    expect(screen.getByTestId('asr-language-input')).toHaveValue('en');
    expect(screen.getByTestId('asr-api-key-input')).toHaveAttribute(
      'placeholder',
      'An API key is already configured for this provider. Leave blank to keep it.',
    );
    expect(screen.getByTestId('asr-api-key-input')).toHaveValue('');
  });

  it('prefills openai defaults when no config exists', async () => {
    getConfigMock.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    renderAsrSettings();

    expect(await screen.findByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.openai.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.openai.model);
    expect(screen.getByTestId('asr-api-key-input')).not.toHaveAttribute('placeholder');
  });

  it('shows the provider console link only for siliconflow and opens it externally', async () => {
    getConfigMock.mockResolvedValue(configResult({ config: { preset: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B' } }));

    renderAsrSettings();

    const link = await screen.findByTestId('asr-api-key-link');
    expect(link).toHaveTextContent('Get API key');
    fireEvent.click(link);
    expect(openExternalMock).toHaveBeenCalledWith('https://cloud.siliconflow.cn/me/account/ak');

    fireEvent.change(screen.getByTestId('asr-preset-select'), { target: { value: 'openai' } });
    expect(screen.queryByTestId('asr-api-key-link')).not.toBeInTheDocument();
  });

  it('renders the language select with auto-detect plus zh and en options', async () => {
    getConfigMock.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    renderAsrSettings();

    const languageSelect = await screen.findByTestId('asr-language-input');
    expect(languageSelect).toHaveValue('');
    expect(languageSelect.children).toHaveLength(3);
    expect(languageSelect.children[0]).toHaveTextContent('Auto-detect (recommended)');
    expect(languageSelect.children[1]).toHaveTextContent('zh');
    expect(languageSelect.children[2]).toHaveTextContent('en');
  });

  it('overwrites base URL and model with the preset defaults when switching presets', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-preset-select'), { target: { value: 'siliconflow' } });

    expect(screen.getByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.siliconflow.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.siliconflow.model);

    fireEvent.change(screen.getByTestId('asr-preset-select'), { target: { value: 'groq' } });

    expect(screen.getByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.groq.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.groq.model);
  });

  it('blocks saving when the model is empty and shows an error toast', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-model-input');

    fireEvent.change(screen.getByTestId('asr-model-input'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Enter a model name.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('blocks saving when the base URL is not http(s) and shows an error toast', async () => {
    getConfigMock.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-base-url-input'), { target: { value: 'ftp://example.com' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('The base URL must start with http:// or https://.');
  });

  it('saves the entered values and shows the success toast', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-base-url-input'), { target: { value: 'https://example.com/v1' } });
    fireEvent.change(screen.getByTestId('asr-model-input'), { target: { value: 'whisper-1' } });
    fireEvent.change(screen.getByTestId('asr-language-input'), { target: { value: 'zh' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', baseUrl: 'https://example.com/v1', model: 'whisper-1', language: 'zh' },
      undefined,
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Speech-to-text settings saved.');
  });

  it('passes undefined as the api key when the field stays untouched', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', language: 'en' },
      undefined,
    );
  });

  it('passes the typed api key through to saveConfig', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-api-key-input'), { target: { value: ' sk-new-key ' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', language: 'en' },
      'sk-new-key',
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Speech-to-text settings saved.');
  });

  it('maps a serialized ASR save rejection to the generic failure toast', async () => {
    getConfigMock.mockResolvedValue(configResult());

    renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    saveConfigMock.mockRejectedValue(new Error('ASR:INVALID_INPUT:Invalid URL'));
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Saving failed. Please try again.');
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

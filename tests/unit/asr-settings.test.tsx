import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsrSettings } from '@/components/settings/AsrSettings';
import { TooltipProvider } from '@/components/ui/tooltip';
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
    case 'settings:asr.protocol.label':
      return 'API type';
    case 'settings:asr.protocol.transcriptions':
      return 'OpenAI Audio Transcriptions';
    case 'settings:asr.protocol.chat':
      return 'OpenAI Chat Completions';
    case 'settings:asr.presets.label':
      return 'Provider';
    case 'settings:asr.presets.openai':
      return 'OpenAI';
    case 'settings:asr.presets.groq':
      return 'Groq';
    case 'settings:asr.presets.siliconflow':
      return 'SiliconFlow';
    case 'settings:asr.presets.bailian':
      return 'Alibaba Cloud Model Studio';
    case 'settings:asr.presets.custom':
      return 'Custom';
    case 'settings:asr.baseUrl':
      return 'API base URL';
    case 'settings:asr.hints.bailianDialect':
      return 'Alibaba Cloud Model Studio encodes input_audio in its own non-standard dialect (Data URI); ClawX adapts it automatically.';
    case 'settings:asr.hints.bailianWorkspace':
      return 'Replace <WorkspaceId> with your Model Studio workspace ID. The Beijing and Singapore regions use different domains and API keys.';
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
    case 'settings:aiProviders.dialog.baseUrlInvalid':
      return 'Enter a valid URL starting with http:// or https://.';
    case 'settings:aiProviders.dialog.apiKeyRequired':
      return 'Enter an API key.';
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

async function renderAsrSettings() {
  render(<TooltipProvider><AsrSettings /></TooltipProvider>);
  fireEvent.click(await screen.findByTestId('asr-configure'));
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


  it('shows saved state before opening configuration and choosing Bailian selects its protocol', async () => {
    getConfigMock.mockResolvedValue(configResult());
    render(<TooltipProvider><AsrSettings /></TooltipProvider>);
    expect(await screen.findByTestId('asr-summary')).toHaveTextContent('whisper-large-v3');
    expect(screen.queryByTestId('asr-config-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('asr-configure'));
    selectPreset('bailian');
    expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Chat Completions');
    expect(screen.queryByTestId('asr-protocol-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('asr-model-input')).toHaveValue('qwen3-asr-flash');
  });

  it('loads the existing config into the inputs and masks the stored key', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();

    expect(await screen.findByTestId('asr-base-url-input')).toHaveValue('https://api.groq.com/openai/v1');
    expect(screen.getByTestId('asr-preset-groq')).toHaveAttribute('aria-pressed', 'true');
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

    await renderAsrSettings();

    expect(await screen.findByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.openai.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.openai.model);
    expect(screen.getByTestId('asr-api-key-input')).not.toHaveAttribute('placeholder');
  });

  it('shows the provider console link for siliconflow and bailian and opens it externally', async () => {
    getConfigMock.mockResolvedValue(configResult({ config: { preset: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-ASR-1.7B' } }));

    await renderAsrSettings();

    const link = await screen.findByTestId('asr-api-key-link');
    expect(link).toHaveTextContent('Get API key');
    fireEvent.click(link);
    expect(openExternalMock).toHaveBeenCalledWith('https://cloud.siliconflow.cn/me/account/ak');

    selectPreset('openai');
    expect(screen.queryByTestId('asr-api-key-link')).not.toBeInTheDocument();

    selectPreset('bailian');
    fireEvent.click(screen.getByTestId('asr-api-key-link'));
    expect(openExternalMock).toHaveBeenCalledWith('https://bailian.console.aliyun.com/?apiKey=1');
  });

  it('renders the language select with auto-detect plus zh and en options', async () => {
    getConfigMock.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    await renderAsrSettings();

    const languageSelect = await screen.findByTestId('asr-language-input');
    expect(languageSelect).toHaveValue('');
    fireEvent.keyDown(languageSelect, { key: 'ArrowDown' });
    expect((await screen.findAllByRole('option')).map(option => option.textContent)).toEqual(['Auto-detect (recommended)', 'zh', 'en']);
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });

  it('overwrites base URL and model with the preset defaults when switching presets', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    selectPreset('siliconflow');

    expect(screen.getByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.siliconflow.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.siliconflow.model);

    selectPreset('groq');

    expect(screen.getByTestId('asr-base-url-input')).toHaveValue(ASR_PRESET_DEFAULTS.groq.baseUrl);
    expect(screen.getByTestId('asr-model-input')).toHaveValue(ASR_PRESET_DEFAULTS.groq.model);
  });

  it('clears a typed key on provider switch and asks for the new provider key before saving', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    const keyInput = screen.getByTestId('asr-api-key-input');
    fireEvent.change(keyInput, { target: { value: 'previous-provider-fixture' } });
    selectPreset('siliconflow');
    expect(keyInput).toHaveValue('');
    expect(keyInput).not.toHaveAttribute('placeholder');
    fireEvent.click(screen.getByTestId('asr-save-button'));
    expect(keyInput).toHaveAccessibleDescription('Enter an API key.');
    expect(saveConfigMock).not.toHaveBeenCalled();

    selectPreset('groq');
    expect(keyInput).toHaveAttribute('placeholder', 'An API key is already configured for this provider. Leave blank to keep it.');
    expect(keyInput).not.toHaveAttribute('aria-describedby');
  });

  it('shows the appended transcriptions suffix for standard presets but not for custom', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    expect(screen.getByTestId('asr-base-url-suffix')).toHaveTextContent('/audio/transcriptions');

    selectPreset('custom');

    expect(screen.queryByTestId('asr-base-url-suffix')).not.toBeInTheDocument();
    expect(screen.getByTestId('asr-base-url-input')).toHaveAttribute(
      'placeholder',
      'https://api.example.com/v1/audio/transcriptions',
    );

    selectPreset('openai');

    expect(screen.getByTestId('asr-base-url-suffix')).toBeInTheDocument();
  });

  it('shows each preset’s API type without offering an editable protocol for built-in services', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    for (const preset of ['openai', 'groq', 'siliconflow']) {
      selectPreset(preset);
      expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Audio Transcriptions');
      expect(screen.queryByTestId('asr-protocol-select')).not.toBeInTheDocument();
    }

    selectPreset('bailian');
    expect(screen.getByTestId('asr-preset-bailian')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Chat Completions');
    expect(screen.queryByTestId('asr-protocol-select')).not.toBeInTheDocument();
    const presets = within(screen.getByTestId('asr-config-services')).getAllByRole('button');
    expect(presets.map(option => option.getAttribute('data-testid'))).toEqual(
      ['openai', 'groq', 'siliconflow', 'bailian', 'custom'].map(preset => `asr-preset-${preset}`),
    );
    expect(screen.getByTestId('asr-base-url-input')).toHaveValue(
      'https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    );
    expect(screen.getByTestId('asr-model-input')).toHaveValue('qwen3-asr-flash');
    expect(screen.queryByTestId('asr-base-url-suffix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asr-language-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('asr-bailian-dialect-hint')).toBeInTheDocument();
    expect(screen.getByTestId('asr-bailian-workspace-hint')).toBeInTheDocument();
    expect(screen.getByTestId('asr-api-key-link')).toHaveAttribute('title', 'Open the provider console to get an API key');

    selectPreset('custom');

    expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Audio Transcriptions');
    expect(screen.queryByTestId('asr-protocol-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asr-bailian-dialect-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asr-bailian-workspace-hint')).not.toBeInTheDocument();
  });

  it('saves the Bailian preset with its chat protocol and omits the language field', async () => {
    getConfigMock.mockResolvedValue({
      configured: true,
      config: {
        preset: 'bailian',
        baseUrl: 'https://ws123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-asr-flash',
      },
      hasApiKey: true,
    });

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Chat Completions');

    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      {
        preset: 'bailian',
        protocol: 'chat',
        baseUrl: 'https://ws123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3-asr-flash',
      },
      undefined,
    );
  });

  it('uses transcriptions when saving an existing custom chat endpoint', async () => {
    getConfigMock.mockResolvedValue(configResult({
      config: { preset: 'custom', protocol: 'chat', baseUrl: 'https://voice.example/v1', model: 'custom-voice' },
    }));

    await renderAsrSettings();
    expect(screen.getByTestId('asr-protocol-hint')).toHaveTextContent('OpenAI Audio Transcriptions');
    expect(screen.queryByTestId('asr-protocol-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('asr-preset-custom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('asr-base-url-input')).toHaveValue('https://voice.example/v1');
    expect(screen.getByTestId('asr-model-input')).toHaveValue('custom-voice');
    expect(screen.getByTestId('asr-language-input')).toBeVisible();
    expect(saveConfigMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('asr-save-button'));
    await waitFor(() => expect(saveConfigMock).toHaveBeenCalledWith({
      preset: 'custom',
      protocol: 'transcriptions',
      baseUrl: 'https://voice.example/v1',
      model: 'custom-voice',
    }, undefined));
  });

  it('blocks saving when the model is empty and shows an inline error', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-model-input');

    fireEvent.change(screen.getByTestId('asr-model-input'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('asr-model-input')).toHaveAccessibleDescription('Enter a model name.');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('blocks saving when the base URL is not http(s) and shows an inline error', async () => {
    getConfigMock.mockResolvedValue({ configured: false, config: null, hasApiKey: false });

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-base-url-input'), { target: { value: 'ftp://example.com' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('asr-base-url-input')).toHaveAccessibleDescription('Enter a valid URL starting with http:// or https://.');
  });

  it('saves the entered values and shows the success toast', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-base-url-input'), { target: { value: 'https://example.com/v1' } });
    fireEvent.change(screen.getByTestId('asr-model-input'), { target: { value: 'whisper-1' } });
    await selectChoice(screen.getByTestId('asr-language-input'), 'zh');
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', protocol: 'transcriptions', baseUrl: 'https://example.com/v1', model: 'whisper-1', language: 'zh' },
      undefined,
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Speech-to-text settings saved.');
  });

  it('passes undefined as the api key when the field stays untouched', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', protocol: 'transcriptions', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', language: 'en' },
      undefined,
    );
  });

  it('passes the typed api key through to saveConfig', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    fireEvent.change(screen.getByTestId('asr-api-key-input'), { target: { value: ' sk-new-key ' } });
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(saveConfigMock).toHaveBeenCalledWith(
      { preset: 'groq', protocol: 'transcriptions', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3', language: 'en' },
      'sk-new-key',
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Speech-to-text settings saved.');
  });

  it('maps a serialized ASR save rejection to the generic failure toast', async () => {
    getConfigMock.mockResolvedValue(configResult());

    await renderAsrSettings();
    await screen.findByTestId('asr-base-url-input');

    saveConfigMock.mockRejectedValue(new Error('ASR:INVALID_INPUT:Invalid URL'));
    fireEvent.click(screen.getByTestId('asr-save-button'));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Saving failed. Please try again.');
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});

function selectPreset(preset: string) {
  fireEvent.click(screen.getByTestId(`asr-preset-${preset}`));
}

async function selectChoice(trigger: HTMLElement, value: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const options = await screen.findAllByRole('option');
  const option = options.find(item => item.getAttribute('data-value') === value);
  if (!option) throw new Error(`Missing option ${value}`);
  fireEvent.keyDown(option, { key: 'Enter' });
}

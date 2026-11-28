/**
 * Global speech-to-text (ASR) settings for voice dictation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { hostApi } from '@/lib/host-api';
import { parseAsrErrorCode, type AsrErrorCode } from '@shared/asr/errors';
import {
  ASR_PRESET_DEFAULTS,
  ASR_PRESETS_BY_PROTOCOL,
} from '@shared/asr/presets';
import type { AsrConfig, AsrPreset } from '@shared/host-api/contract';
import { ModelConfigDialog, modelFieldClasses, modelFieldLabelClasses } from './ModelConfigDialog';
import { ModelConfigActions, ModelConfigHeading, ModelConfigOption, ModelConfigPanels, ModelServiceIcon } from './ModelConfigPanels';
import { ModelConfigurationSummary } from './ModelConfigurationSummary';
import { cn } from '@/lib/utils';

const inputClasses = modelFieldClasses;
const labelClasses = modelFieldLabelClasses;

const ASR_LANGUAGE_OPTIONS = ['zh', 'en'] as const;
const ASR_PRESETS = Object.keys(ASR_PRESET_DEFAULTS) as AsrPreset[];

type AsrFieldErrors = Partial<Record<'baseUrl' | 'model' | 'apiKey', string>>;

const ASR_PROVIDER_CONSOLES: Partial<Record<AsrPreset, string>> = {
  siliconflow: 'https://cloud.siliconflow.cn/me/account/ak',
  bailian: 'https://bailian.console.aliyun.com/?apiKey=1',
};

const BAILIAN_DOCS_URL =
  'https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide#使用openai兼容api';

const ASR_SAVE_ERROR_CODES: ReadonlySet<string> = new Set<AsrErrorCode>([
  'INVALID_INPUT',
  'NOT_CONFIGURED',
  'AUTH',
  'RATE_LIMITED',
  'SERVER',
  'REQUEST',
  'NETWORK',
  'EMPTY_RESULT',
]);

function resolveSaveErrorCode(error: unknown): AsrErrorCode {
  const message = error instanceof Error ? error.message : '';
  const parsed = message ? parseAsrErrorCode(message) : null;
  if (parsed) return parsed;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ASR_SAVE_ERROR_CODES.has(code)) {
    return code as AsrErrorCode;
  }
  return 'REQUEST';
}

export function AsrSettings() {
  const { t } = useTranslation(['settings', 'dashboard', 'common']);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savedConfig, setSavedConfig] = useState<AsrConfig | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [preset, setPreset] = useState<AsrPreset>('openai');
  const [baseUrl, setBaseUrl] = useState(ASR_PRESET_DEFAULTS.openai.baseUrl);
  const [model, setModel] = useState(ASR_PRESET_DEFAULTS.openai.model);
  const [language, setLanguage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [errors, setErrors] = useState<AsrFieldErrors>({});
  const isCustom = preset === 'custom';
  const protocol = preset !== 'custom' && ASR_PRESETS_BY_PROTOCOL.chat.includes(preset) ? 'chat' : 'transcriptions';
  const canKeepApiKey = hasApiKey && savedConfig?.preset === preset;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.asr.getConfig();
      setSavedConfig(result.config);
      setConfigured(result.configured);
      setHasApiKey(result.hasApiKey);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePresetChange = (next: AsrPreset) => {
    if (next === preset) return;
    setPreset(next);
    setBaseUrl(ASR_PRESET_DEFAULTS[next].baseUrl);
    setModel(ASR_PRESET_DEFAULTS[next].model);
    setApiKey('');
    setErrors({});
  };

  const handleSave = async () => {
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    const trimmedApiKey = apiKey.trim();
    const nextErrors: AsrFieldErrors = {};
    if (!trimmedBaseUrl) {
      nextErrors.baseUrl = t('settings:aiProviders.dialog.baseUrlRequired');
    } else if (!/^https?:\/\//i.test(trimmedBaseUrl) || !URL.canParse(trimmedBaseUrl)) {
      nextErrors.baseUrl = t('settings:aiProviders.dialog.baseUrlInvalid');
    }
    if (!trimmedModel) nextErrors.model = t('settings:asr.errors.modelRequired');
    if (hasApiKey && !canKeepApiKey && !trimmedApiKey) {
      nextErrors.apiKey = t('settings:aiProviders.dialog.apiKeyRequired');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const config: AsrConfig = { preset, protocol, baseUrl: trimmedBaseUrl, model: trimmedModel };
      const trimmedLanguage = language.trim();
      if (protocol === 'transcriptions' && trimmedLanguage) {
        config.language = trimmedLanguage;
      }
      const next = await hostApi.asr.saveConfig(config, trimmedApiKey || undefined);
      setHasApiKey(next.hasApiKey);
      setSavedConfig(next.config);
      setConfigured(next.configured);
      setEditorOpen(false);
      setApiKey('');
      toast.success(t('settings:asr.toast.saved'));
    } catch (error) {
      const code = resolveSaveErrorCode(error);
      toast.error(t(`settings:asr.errors.${code}`, { defaultValue: t('settings:asr.errors.request') }));
    } finally {
      setSaving(false);
    }
  };

  const providerConsoleUrl = ASR_PROVIDER_CONSOLES[preset];
  const openEditor = () => {
    const current = savedConfig;
    setPreset(current?.preset ?? 'openai');
    setBaseUrl(current?.baseUrl ?? ASR_PRESET_DEFAULTS.openai.baseUrl);
    setModel(current?.model ?? ASR_PRESET_DEFAULTS.openai.model);
    setLanguage(current?.language ?? '');
    setApiKey('');
    setErrors({});
    setEditorOpen(true);
  };
  const presetLabel = (value: AsrPreset) => value === 'custom'
    ? t('settings:aiProviders.dialog.customService')
    : t(`settings:asr.presets.${value}`);
  const presetIcon = (value: AsrPreset) => value === 'bailian' ? 'modelstudio' : value;
  const showTranscriptionsSuffix = protocol === 'transcriptions' && !isCustom;
  const closeEditor = () => setEditorOpen(false);
  const renderPreset = (value: AsrPreset) => (
    <ModelConfigOption
      key={value}
      data-testid={`asr-preset-${value}`}
      selected={value === preset}
      disabled={saving}
      icon={<ModelServiceIcon provider={presetIcon(value)} />}
      onClick={() => handlePresetChange(value)}
    >
      {presetLabel(value)}
    </ModelConfigOption>
  );

  return (
    <div data-testid="asr-settings" className="space-y-4">
      <ModelConfigurationSummary prefix="asr" title={t('settings:asr.title')} description={t('settings:modelManagement.voiceDescription')} model={savedConfig?.model} service={savedConfig ? t(`settings:asr.presets.${savedConfig.preset}`) : undefined} configured={configured} loading={loading} onConfigure={openEditor} triggerRef={triggerRef} />
      <ModelConfigDialog
        open={editorOpen}
        onClose={closeEditor}
        title={t('settings:asr.title')}
        testId="asr-config-dialog"
        layout="split"
        busy={saving}
        returnFocusRef={triggerRef}
        footer={<ModelConfigActions
          footerTestId="asr-config-footer"
          onCancel={closeEditor}
          cancelDisabled={saving}
          label={t('settings:asr.save')}
          testId="asr-save-button"
          onSubmit={handleSave}
          disabled={saving}
          busy={saving}
        />}
      >
        <ModelConfigPanels
          label={t('settings:aiProviders.dialog.serviceList')}
          navigationTestId="asr-config-services"
          detailTestId="asr-config-details"
          options={ASR_PRESETS.filter(value => value !== 'custom').map(renderPreset)}
          trailingOption={renderPreset('custom')}
        >
          <ModelConfigHeading
            title={presetLabel(preset)}
            icon={<ModelServiceIcon provider={presetIcon(preset)} className="h-6 w-6" />}
          />
          <fieldset disabled={saving} data-testid="asr-settings-surface" className="min-w-0 space-y-4">
            <dl data-testid="asr-protocol-hint" className="space-y-2">
              <dt className={labelClasses}>{t('settings:asr.protocol.label')}</dt>
              <dd className="flex min-h-9 items-center text-sm text-foreground">{t(`settings:asr.protocol.${protocol}`)}</dd>
            </dl>
            <div className="space-y-2">
              <Label htmlFor="asr-base-url" className={labelClasses}>{t('settings:aiProviders.dialog.baseUrl')}</Label>
              <div className="flex">
                <Input
                  id="asr-base-url"
                  value={baseUrl}
                  onChange={event => {
                    setBaseUrl(event.target.value);
                    setErrors(previous => ({ ...previous, baseUrl: undefined }));
                  }}
                  placeholder={protocol === 'transcriptions' && isCustom ? 'https://api.example.com/v1/audio/transcriptions' : 'https://api.example.com/v1'}
                  className={cn(inputClasses, 'min-w-0', showTranscriptionsSuffix && 'rounded-r-none')}
                  data-testid="asr-base-url-input"
                  aria-invalid={!!errors.baseUrl}
                  aria-describedby={errors.baseUrl ? 'asr-base-url-error' : undefined}
                />
                {showTranscriptionsSuffix && <span data-testid="asr-base-url-suffix" className="flex shrink-0 items-center rounded-r-lg border border-l-0 border-input bg-surface-input px-2 text-meta text-muted-foreground">/audio/transcriptions</span>}
              </div>
              {errors.baseUrl && <p role="alert" id="asr-base-url-error" className="text-sm text-destructive">{errors.baseUrl}</p>}
              {preset === 'bailian' && (
                <>
                  <p data-testid="asr-bailian-workspace-hint" className="text-sm text-muted-foreground">{t('settings:asr.hints.bailianWorkspace')}</p>
                  <p data-testid="asr-bailian-dialect-hint" className="text-sm text-muted-foreground">
                    {t('settings:asr.hints.bailianDialectPrefix')}
                    <button type="button" className="text-primary hover:underline" data-testid="asr-bailian-docs-link" onClick={() => void hostApi.shell.openExternal(BAILIAN_DOCS_URL)}>
                      {t('settings:asr.hints.bailianDialectLinkText')}
                    </button>
                    {t('settings:asr.hints.bailianDialectSuffix')}
                  </p>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="asr-model" className={labelClasses}>{t('settings:aiProviders.dialog.modelId')}</Label>
              <Input
                id="asr-model"
                value={model}
                onChange={event => {
                  setModel(event.target.value);
                  setErrors(previous => ({ ...previous, model: undefined }));
                }}
                className={inputClasses}
                data-testid="asr-model-input"
                aria-invalid={!!errors.model}
                aria-describedby={errors.model ? 'asr-model-error' : undefined}
              />
              {errors.model && <p role="alert" id="asr-model-error" className="text-sm text-destructive">{errors.model}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="asr-api-key" className={labelClasses}>{t('settings:asr.apiKey')}</Label>
                {providerConsoleUrl && <button type="button" data-testid="asr-api-key-link" title={t('settings:asr.apiKeyLinkTitle')} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => void hostApi.shell.openExternal(providerConsoleUrl)}>
                  {t('settings:asr.apiKeyLink')} <ExternalLink className="h-3 w-3" />
                </button>}
              </div>
              <Input
                id="asr-api-key"
                type="password"
                value={apiKey}
                onChange={event => {
                  setApiKey(event.target.value);
                  setErrors(previous => ({ ...previous, apiKey: undefined }));
                }}
                placeholder={canKeepApiKey ? t('settings:asr.apiKeyConfiguredPlaceholder') : undefined}
                autoComplete="off"
                className={inputClasses}
                data-testid="asr-api-key-input"
                aria-invalid={!!errors.apiKey}
                aria-describedby={errors.apiKey ? 'asr-api-key-error' : undefined}
              />
              {errors.apiKey && <p role="alert" id="asr-api-key-error" className="text-sm text-destructive">{errors.apiKey}</p>}
            </div>
            {protocol === 'transcriptions' && (
              <div className="space-y-2">
                <Label htmlFor="asr-language" className={labelClasses}>{t('settings:asr.language')}</Label>
                <Select id="asr-language" value={language} onValueChange={setLanguage} className={inputClasses} disabled={saving} data-testid="asr-language-input">
                  <SelectItem value="">{t('settings:asr.languageAuto')}</SelectItem>
                  {ASR_LANGUAGE_OPTIONS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                </Select>
              </div>
            )}
          </fieldset>
        </ModelConfigPanels>
      </ModelConfigDialog>
    </div>
  );
}

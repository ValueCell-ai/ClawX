/**
 * Global speech-to-text (ASR) settings for voice dictation.
 */
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { hostApi } from '@/lib/host-api';
import { parseAsrErrorCode, type AsrErrorCode } from '@shared/asr/errors';
import { ASR_PRESET_DEFAULTS } from '@shared/asr/presets';
import type { AsrConfig, AsrPreset } from '@shared/host-api/contract';
import { cn } from '@/lib/utils';

const inputClasses =
  'h-10 rounded-lg font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-sm text-foreground/80 font-bold';

const ASR_PRESETS: AsrPreset[] = ['openai', 'groq', 'siliconflow', 'custom'];

const ASR_LANGUAGE_OPTIONS = ['zh', 'en'] as const;

const ASR_PROVIDER_CONSOLES: Partial<Record<AsrPreset, string>> = {
  siliconflow: 'https://cloud.siliconflow.cn/me/account/ak',
};

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [preset, setPreset] = useState<AsrPreset>('openai');
  const [baseUrl, setBaseUrl] = useState(ASR_PRESET_DEFAULTS.openai.baseUrl);
  const [model, setModel] = useState(ASR_PRESET_DEFAULTS.openai.model);
  const [language, setLanguage] = useState('');
  const [apiKey, setApiKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.asr.getConfig();
      const config = result.config;
      setHasApiKey(result.hasApiKey);
      if (config) {
        setPreset(config.preset);
        setBaseUrl(config.baseUrl);
        setModel(config.model);
        setLanguage(config.language ?? '');
      } else {
        setPreset('openai');
        setBaseUrl(ASR_PRESET_DEFAULTS.openai.baseUrl);
        setModel(ASR_PRESET_DEFAULTS.openai.model);
        setLanguage('');
      }
      setApiKey('');
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
    setPreset(next);
    setBaseUrl(ASR_PRESET_DEFAULTS[next].baseUrl);
    setModel(ASR_PRESET_DEFAULTS[next].model);
  };

  const handleSave = async () => {
    const trimmedBaseUrl = baseUrl.trim();
    if (!/^https?:\/\//i.test(trimmedBaseUrl)) {
      toast.error(t('settings:asr.errors.invalidBaseUrl'));
      return;
    }
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      toast.error(t('settings:asr.errors.modelRequired'));
      return;
    }
    setSaving(true);
    try {
      const config: AsrConfig = { preset, baseUrl: trimmedBaseUrl, model: trimmedModel };
      const trimmedLanguage = language.trim();
      if (trimmedLanguage) {
        config.language = trimmedLanguage;
      }
      const trimmedApiKey = apiKey.trim();
      const next = await hostApi.asr.saveConfig(config, trimmedApiKey || undefined);
      setHasApiKey(next.hasApiKey);
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

  return (
    <div data-testid="asr-settings" className="space-y-6">
      <div>
        <h2
          data-testid="asr-settings-title"
          className="text-3xl font-serif text-foreground font-normal tracking-tight flex items-center gap-2"
        >
          <Mic className="h-7 w-7 text-foreground/70" />
          {t('settings:asr.title')}
        </h2>
        <p className="text-meta text-muted-foreground mt-2 max-w-2xl">
          {t('settings:asr.description')}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-dashed border-transparent">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div
          data-testid="asr-settings-surface"
          className="space-y-4 rounded-xl border border-black/10 bg-surface-modal p-4 shadow-sm dark:border-white/10"
        >
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="asr-preset" className={labelClasses}>
              {t('settings:asr.presets.label')}
            </Label>
            <Select
              id="asr-preset"
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value as AsrPreset)}
              className={cn(inputClasses, 'w-full')}
              data-testid="asr-preset-select"
            >
              {ASR_PRESETS.map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {t(`settings:asr.presets.${presetKey}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="asr-base-url" className={labelClasses}>
              {t('settings:asr.baseUrl')}
            </Label>
            <div className="flex">
              <Input
                id="asr-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={cn(inputClasses, 'rounded-r-none flex-1 min-w-0')}
                data-testid="asr-base-url-input"
              />
              <span
                data-testid="asr-base-url-suffix"
                className="flex items-center rounded-r-lg border border-l-0 border-black/10 bg-black/5 px-3 font-mono text-meta text-muted-foreground dark:border-white/10 dark:bg-white/5 select-none"
              >
                /audio/transcriptions
              </span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="asr-model" className={labelClasses}>
                {t('settings:asr.model')}
              </Label>
              <Input
                id="asr-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={inputClasses}
                data-testid="asr-model-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asr-language" className={labelClasses}>
                {t('settings:asr.language')}
              </Label>
              <Select
                id="asr-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={cn(inputClasses, 'w-full')}
                data-testid="asr-language-input"
              >
                <option value="">{t('settings:asr.languageAuto')}</option>
                {ASR_LANGUAGE_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="asr-api-key" className={labelClasses}>
                {t('settings:asr.apiKey')}
              </Label>
              {providerConsoleUrl ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => void hostApi.shell.openExternal(providerConsoleUrl)}
                  data-testid="asr-api-key-link"
                  title={t('settings:asr.apiKeyLinkTitle')}
                >
                  {t('settings:asr.apiKeyLink')}
                  <ExternalLink className="h-3 w-3" />
                </Button>
              ) : null}
            </div>
            <Input
              id="asr-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? t('settings:asr.apiKeyConfiguredPlaceholder') : undefined}
              className={inputClasses}
              autoComplete="off"
              data-testid="asr-api-key-input"
            />
          </div>
          <div className="flex justify-end">
            <Button
              className="rounded-full h-10"
              onClick={() => void handleSave()}
              disabled={saving}
              data-testid="asr-save-button"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('settings:asr.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

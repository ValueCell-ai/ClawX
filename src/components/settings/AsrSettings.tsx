/**
 * Global speech-to-text (ASR) settings for voice dictation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { hostApi } from '@/lib/host-api';
import { parseAsrErrorCode, type AsrErrorCode } from '@shared/asr/errors';
import {
  ASR_PRESET_DEFAULTS,
  ASR_PRESETS_BY_PROTOCOL,
  ASR_PROTOCOLS,
  normalizeAsrProtocol,
} from '@shared/asr/presets';
import type { AsrConfig, AsrPreset, AsrProtocol } from '@shared/host-api/contract';
import { ModelConfigDialog, modelFieldClasses } from './ModelConfigDialog';
import { ModelConfigurationSummary } from './ModelConfigurationSummary';
import { cn } from '@/lib/utils';

const inputClasses = modelFieldClasses;
const labelClasses = 'text-sm text-foreground/80 font-medium';

const ASR_LANGUAGE_OPTIONS = ['zh', 'en'] as const;

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
  const [protocol, setProtocol] = useState<AsrProtocol>('transcriptions');
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
      setSavedConfig(config);
      setConfigured(result.configured);
      setHasApiKey(result.hasApiKey);
      if (config) {
        setProtocol(normalizeAsrProtocol(config.protocol));
        setPreset(config.preset);
        setBaseUrl(config.baseUrl);
        setModel(config.model);
        setLanguage(config.language ?? '');
      } else {
        setProtocol('transcriptions');
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

  const handleProtocolChange = (next: AsrProtocol) => {
    setProtocol(next);
    if (preset === 'custom') return;
    const nextPreset = ASR_PRESETS_BY_PROTOCOL[next][0];
    setPreset(nextPreset);
    setBaseUrl(ASR_PRESET_DEFAULTS[nextPreset].baseUrl);
    setModel(ASR_PRESET_DEFAULTS[nextPreset].model);
  };

  const handlePresetChange = (next: AsrPreset) => {
    setPreset(next);
    if (next !== 'custom') setProtocol(ASR_PRESETS_BY_PROTOCOL.transcriptions.includes(next) ? 'transcriptions' : 'chat');
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
      const config: AsrConfig = { preset, protocol, baseUrl: trimmedBaseUrl, model: trimmedModel };
      const trimmedLanguage = language.trim();
      if (protocol === 'transcriptions' && trimmedLanguage) {
        config.language = trimmedLanguage;
      }
      const trimmedApiKey = apiKey.trim();
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
    setProtocol(normalizeAsrProtocol(current?.protocol));
    setPreset(current?.preset ?? 'openai');
    setBaseUrl(current?.baseUrl ?? ASR_PRESET_DEFAULTS.openai.baseUrl);
    setModel(current?.model ?? ASR_PRESET_DEFAULTS.openai.model);
    setLanguage(current?.language ?? '');
    setApiKey('');
    setEditorOpen(true);
  };
  return (
    <div data-testid="asr-settings" className="space-y-4">
      <ModelConfigurationSummary prefix="asr" title={t('settings:asr.title')} description={t('settings:modelManagement.voiceDescription')} model={savedConfig?.model} service={savedConfig ? t(`settings:asr.presets.${savedConfig.preset}`) : undefined} configured={configured} loading={loading} onConfigure={openEditor} triggerRef={triggerRef} />
      <ModelConfigDialog open={editorOpen} onClose={() => setEditorOpen(false)} title={t('settings:asr.title')} description={t('settings:modelManagement.voiceDescription')} testId="asr-config-dialog" busy={saving} returnFocusRef={triggerRef}
        footer={<><Button variant="outline" className="h-9" disabled={saving} onClick={() => setEditorOpen(false)}>{t('settings:aiProviders.dialog.cancel')}</Button><Button onClick={() => void handleSave()} disabled={saving} className="h-9" data-testid="asr-save-button">{saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{t('settings:asr.save')}</Button></>}
      >
        <fieldset disabled={saving} data-testid="asr-settings-surface" className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="asr-preset" className={labelClasses}>{t('settings:asr.presets.label')}</Label><Select id="asr-preset" value={preset} onValueChange={value => handlePresetChange(value as AsrPreset)} className={inputClasses} data-testid="asr-preset-select">{(Object.keys(ASR_PRESET_DEFAULTS) as AsrPreset[]).map(key => <SelectItem key={key} value={key}>{t(`settings:asr.presets.${key}`)}</SelectItem>)}</Select></div>
            <div className="space-y-1.5"><Label htmlFor="asr-model" className={labelClasses}>{t('settings:asr.model')}</Label><Input id="asr-model" value={model} onChange={event => setModel(event.target.value)} className={inputClasses} data-testid="asr-model-input" /></div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2"><Label htmlFor="asr-api-key" className={labelClasses}>{t('settings:asr.apiKey')}</Label>{providerConsoleUrl && <button type="button" data-testid="asr-api-key-link" title={t('settings:asr.apiKeyLinkTitle')} className="inline-flex items-center gap-1 text-xs text-primary" onClick={() => void hostApi.shell.openExternal(providerConsoleUrl)}>{t('settings:asr.apiKeyLink')}<ExternalLink className="h-3 w-3" /></button>}</div>
            {!hasApiKey && <p data-testid="asr-api-key-status" className="text-xs text-muted-foreground">{t('settings:aiProviders.dialog.apiKeyMissing')}</p>}
            <Input id="asr-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={hasApiKey ? t('settings:asr.apiKeyConfiguredPlaceholder') : undefined} autoComplete="off" className={inputClasses} data-testid="asr-api-key-input" />
          </div>
          {protocol === 'transcriptions' && <div className="space-y-1.5"><Label htmlFor="asr-language">{t('settings:asr.language')}</Label><Select id="asr-language" value={language} onValueChange={setLanguage} className={inputClasses} data-testid="asr-language-input"><SelectItem value="">{t('settings:asr.languageAuto')}</SelectItem>{ASR_LANGUAGE_OPTIONS.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</Select></div>}
          <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('settings:aiProviders.dialog.advancedConfig')}</summary><div className="mt-4 space-y-4">
            <div className="space-y-1.5"><Label htmlFor="asr-protocol">{t('settings:asr.protocol.label')}</Label><Select id="asr-protocol" value={protocol} onValueChange={value => handleProtocolChange(value as AsrProtocol)} className={inputClasses} data-testid="asr-protocol-select">{ASR_PROTOCOLS.map(value => <SelectItem key={value} value={value}>{t(`settings:asr.protocol.${value}`)}</SelectItem>)}</Select></div>
            <div className="space-y-1.5"><Label htmlFor="asr-base-url">{t('settings:asr.baseUrl')}</Label><div className="flex"><Input id="asr-base-url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={protocol === 'transcriptions' && preset === 'custom' ? 'https://api.example.com/v1/audio/transcriptions' : 'https://api.example.com/v1'} className={cn(inputClasses, 'min-w-0', protocol === 'transcriptions' && preset !== 'custom' && 'rounded-r-none')} data-testid="asr-base-url-input" />{protocol === 'transcriptions' && preset !== 'custom' && <span data-testid="asr-base-url-suffix" className="flex shrink-0 items-center rounded-r-lg border border-l-0 border-input bg-surface-input px-2 text-[11px] text-muted-foreground">/audio/transcriptions</span>}</div></div>
            {preset === 'bailian' && <><p data-testid="asr-bailian-workspace-hint" className="text-xs leading-relaxed text-muted-foreground">{t('settings:asr.hints.bailianWorkspace')}</p><p data-testid="asr-bailian-dialect-hint" className="text-xs leading-relaxed text-muted-foreground">{t('settings:asr.hints.bailianDialectPrefix')}<button type="button" className="text-primary hover:underline" data-testid="asr-bailian-docs-link" onClick={() => void hostApi.shell.openExternal(BAILIAN_DOCS_URL)}>{t('settings:asr.hints.bailianDialectLinkText')}</button>{t('settings:asr.hints.bailianDialectSuffix')}</p></>}
          </div></details>
        </fieldset>
      </ModelConfigDialog>
    </div>
  );
}

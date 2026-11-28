import { Select, SelectItem } from '@/components/ui/select';
/**
 * Global image generation settings (agents.defaults.mediaModels.image).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Play, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  clearImageGenerationSettings,
  fetchImageGenerationSettings,
  runImageGenerationTest,
  saveImageGenerationSettings,
  type ImageGenerationSettingsSnapshot,
} from '@/lib/image-generation';
import { ModelConfigDialog, modelFieldClasses, modelFieldLabelClasses } from './ModelConfigDialog';
import { ModelConfigActions, ModelConfigHeading, ModelConfigOption, ModelConfigPanels, ModelServiceIcon } from './ModelConfigPanels';
import { ModelConfigurationSummary } from './ModelConfigurationSummary';
import { cn } from '@/lib/utils';

const inputClasses = modelFieldClasses;
const labelClasses = modelFieldLabelClasses;

type ImageConfigSection = 'endpoint' | 'advanced';
type ImageFieldErrors = Partial<Record<'baseUrl' | 'model' | 'apiKey' | 'timeout', string>>;

function extractTestOutputPath(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const outputs = (result as { outputs?: unknown }).outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  const first = outputs[0];
  if (!first || typeof first !== 'object') return null;
  const pathValue = (first as { path?: unknown }).path;
  return typeof pathValue === 'string' && pathValue.trim() ? pathValue.trim() : null;
}

export function ImageGenerationSettings() {
  const { t } = useTranslation(['dashboard', 'settings', 'common']);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [section, setSection] = useState<ImageConfigSection>('endpoint');
  const [errors, setErrors] = useState<ImageFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ImageGenerationSettingsSnapshot | null>(null);

  const [timeoutMs, setTimeoutMs] = useState('180000');
  const [relayBaseUrl, setRelayBaseUrl] = useState('');
  const [relayModel, setRelayModel] = useState('gpt-image-2');
  const [relayApiKey, setRelayApiKey] = useState('');
  const [showRelayApiKey, setShowRelayApiKey] = useState(false);
  const [testAgentId, setTestAgentId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const settings = await fetchImageGenerationSettings();
      setSnapshot(settings);
      setTimeoutMs(settings.config.timeoutMs ? String(settings.config.timeoutMs) : '180000');
      setRelayBaseUrl(settings.openAiRelay?.baseUrl ?? '');
      setRelayModel(settings.openAiRelay?.model || 'gpt-image-2');
      setRelayApiKey('');
      setShowRelayApiKey(false);
      setTestAgentId(settings.defaultAgentId);
      setErrors({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!snapshot) return false;
    const timeoutParsed = timeoutMs.trim() ? Number.parseInt(timeoutMs, 10) : null;
    const savedTimeout = snapshot.config.timeoutMs ?? 180000;
    return (
      timeoutParsed !== savedTimeout
      || relayBaseUrl.trim() !== (snapshot.openAiRelay?.baseUrl ?? '').trim()
      || relayModel.trim() !== (snapshot.openAiRelay?.model ?? '').trim()
      || relayApiKey.trim().length > 0
    );
  }, [snapshot, timeoutMs, relayBaseUrl, relayModel, relayApiKey]);

  const hasConfiguredRelay = useMemo(() => {
    if (!snapshot) return false;
    return Boolean(
      snapshot.openAiRelay?.enabled
      || snapshot.openAiRelay?.baseUrl?.trim()
      || snapshot.config.primary?.trim(),
    );
  }, [snapshot]);

  const handleSave = async () => {
    const timeoutParsed = timeoutMs.trim() ? Number.parseInt(timeoutMs, 10) : null;
    const baseUrl = relayBaseUrl.trim();
    const model = relayModel.trim();
    const apiKey = relayApiKey.trim();
    const nextErrors: ImageFieldErrors = {};
    if (!baseUrl) {
      nextErrors.baseUrl = t('settings:aiProviders.dialog.baseUrlRequired');
    } else if (!/^https?:\/\//i.test(baseUrl) || !URL.canParse(baseUrl)) {
      nextErrors.baseUrl = t('settings:aiProviders.dialog.baseUrlInvalid');
    }
    if (!model) {
      nextErrors.model = t('imageGeneration.errors.relayModelRequired');
    } else if (model.includes('/')) {
      nextErrors.model = t('imageGeneration.errors.relayModelInvalid');
    }
    if (!apiKey && !canKeepRelayApiKey) nextErrors.apiKey = t('settings:aiProviders.dialog.apiKeyRequired');
    if (timeoutParsed !== null && (!Number.isFinite(timeoutParsed) || timeoutParsed <= 0)) {
      nextErrors.timeout = t('imageGeneration.errors.invalidTimeout');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSection(nextErrors.baseUrl || nextErrors.model || nextErrors.apiKey ? 'endpoint' : 'advanced');
      return;
    }

    setSaving(true);
    try {
      const next = await saveImageGenerationSettings({
        timeoutMs: timeoutParsed,
        openAiRelayEnabled: true,
        openAiRelayBaseUrl: baseUrl,
        openAiRelayModel: model,
        openAiRelayApiKey: apiKey || undefined,
      });
      setSnapshot(next);
      setRelayBaseUrl(next.openAiRelay?.baseUrl ?? '');
      setRelayModel(next.openAiRelay?.model || 'gpt-image-2');
      setRelayApiKey('');
      setShowRelayApiKey(false);
      setEditorOpen(false);
      toast.success(t('imageGeneration.toast.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      const next = await clearImageGenerationSettings();
      setSnapshot(next);
      setRelayBaseUrl('');
      setRelayModel('gpt-image-2');
      setRelayApiKey('');
      setShowRelayApiKey(false);
      setClearConfirmOpen(false);
      setEditorOpen(false);
      toast.success(t('imageGeneration.toast.cleared'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  };

  const handleTest = async () => {
    if (dirty) {
      toast.message(t('imageGeneration.toast.saveBeforeTest'));
      return;
    }
    if (!hasConfiguredRelay) {
      return;
    }
    setTesting(true);
    try {
      const result = await runImageGenerationTest({
        agentId: testAgentId || snapshot?.defaultAgentId,
        prompt: t('imageGeneration.testPrompt'),
      });
      if (result.success) {
        const outputPath = extractTestOutputPath(result.result);
        if (outputPath) {
          toast.success(t('imageGeneration.toast.testSuccessWithPath', {
            ms: Math.round(result.durationMs),
            path: outputPath,
          }));
        } else {
          toast.success(t('imageGeneration.toast.testSuccess', { ms: Math.round(result.durationMs) }));
        }
      } else {
        toast.error(result.error || result.stderr || t('imageGeneration.toast.testFailed'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const openEditor = () => {
    setTimeoutMs(String(snapshot?.config.timeoutMs ?? 180000));
    setRelayBaseUrl(snapshot?.openAiRelay?.baseUrl ?? '');
    setRelayModel(snapshot?.openAiRelay?.model || 'gpt-image-2');
    setRelayApiKey('');
    setShowRelayApiKey(false);
    setSection('endpoint');
    setErrors({});
    setEditorOpen(true);
  };
  let service = '';
  try { service = snapshot?.openAiRelay.baseUrl ? new URL(snapshot.openAiRelay.baseUrl).host : ''; } catch { /* Preserve editable saved settings. */ }
  const configured = hasConfiguredRelay && Boolean(snapshot?.openAiRelay.apiKeyConfigured || snapshot?.agents.some(agent => agent.configured));
  const busy = saving || clearing;
  const canKeepRelayApiKey = !!snapshot?.openAiRelay.apiKeyConfigured && snapshot.openAiRelay.providerKey !== 'openai';
  const endpointTitle = t('imageGeneration.openAiRelay.title');
  const advancedTitle = t('settings:aiProviders.dialog.advancedConfig');
  const advancedIcon = <SlidersHorizontal aria-hidden="true" className="h-5 w-5 shrink-0" />;
  const closeEditor = () => setEditorOpen(false);

  return (
    <div data-testid="image-generation-settings" className="space-y-4">
      <ModelConfigurationSummary prefix="image-generation" title={t('imageGeneration.title')} description={t('settings:modelManagement.imageDescription')} model={hasConfiguredRelay ? snapshot?.openAiRelay.model || snapshot?.config.primary || undefined : undefined} service={service} configured={configured} loading={loading} onConfigure={openEditor} triggerRef={triggerRef} actions={hasConfiguredRelay && !loading ? (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={clearing} data-testid="image-generation-clear" aria-label={t('imageGeneration.clear')} onClick={() => setClearConfirmOpen(true)}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button></TooltipTrigger>
          <TooltipContent>{t('imageGeneration.clear')}</TooltipContent>
        </Tooltip>
      ) : undefined} />
      <ModelConfigDialog
        open={editorOpen}
        onClose={closeEditor}
        title={t('imageGeneration.title')}
        testId="image-generation-config-dialog"
        layout="split"
        busy={busy}
        returnFocusRef={triggerRef}
        footer={<ModelConfigActions
          footerTestId="image-generation-footer"
          onCancel={closeEditor}
          cancelDisabled={busy}
          label={t('imageGeneration.save')}
          testId="image-generation-save"
          onSubmit={handleSave}
          disabled={busy || !dirty}
          busy={saving}
        />}
      >
        <ModelConfigPanels
          label={t('imageGeneration.title')}
          navigationTestId="image-generation-config-sections"
          detailTestId="image-generation-config-details"
          detailKey={section}
          options={
            <ModelConfigOption data-testid="image-generation-endpoint-section" icon={<ModelServiceIcon provider="custom" />} selected={section === 'endpoint'} disabled={busy} onClick={() => setSection('endpoint')}>
              {endpointTitle}
            </ModelConfigOption>
          }
          trailingOption={
            <ModelConfigOption data-testid="image-generation-advanced" icon={advancedIcon} selected={section === 'advanced'} disabled={busy} onClick={() => setSection('advanced')}>
              {advancedTitle}
            </ModelConfigOption>
          }
        >
          <ModelConfigHeading
            title={section === 'endpoint' ? endpointTitle : advancedTitle}
            icon={section === 'endpoint' ? <ModelServiceIcon provider="custom" className="h-6 w-6" /> : advancedIcon}
          />
          <fieldset disabled={busy} data-testid="image-generation-settings-surface" className="min-w-0 space-y-4">
            {section === 'endpoint' ? (
              <div data-testid="image-generation-openai-relay" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="image-gen-relay-base-url" className={labelClasses}>{t('settings:aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    id="image-gen-relay-base-url"
                    value={relayBaseUrl}
                    onChange={event => {
                      setRelayBaseUrl(event.target.value);
                      setErrors(previous => ({ ...previous, baseUrl: undefined }));
                    }}
                    placeholder="https://api.example.com/v1"
                    className={inputClasses}
                    data-testid="image-generation-relay-base-url"
                    aria-invalid={!!errors.baseUrl}
                    aria-describedby={errors.baseUrl ? 'image-gen-relay-base-url-error' : undefined}
                  />
                  {errors.baseUrl && <p role="alert" id="image-gen-relay-base-url-error" className="text-sm text-destructive">{errors.baseUrl}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-gen-relay-model" className={labelClasses}>{t('settings:aiProviders.dialog.modelId')}</Label>
                  <Input
                    id="image-gen-relay-model"
                    value={relayModel}
                    onChange={event => {
                      setRelayModel(event.target.value);
                      setErrors(previous => ({ ...previous, model: undefined }));
                    }}
                    placeholder="gpt-image-2"
                    className={inputClasses}
                    data-testid="image-generation-relay-model"
                    aria-invalid={!!errors.model}
                    aria-describedby={errors.model ? 'image-gen-relay-model-error' : undefined}
                  />
                  {errors.model && <p role="alert" id="image-gen-relay-model-error" className="text-sm text-destructive">{errors.model}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-gen-relay-api-key" className={labelClasses}>
                    {t('settings:aiProviders.dialog.apiKey')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="image-gen-relay-api-key"
                      type={showRelayApiKey ? 'text' : 'password'}
                      value={relayApiKey}
                      onChange={event => {
                        setRelayApiKey(event.target.value);
                        setErrors(previous => ({ ...previous, apiKey: undefined }));
                      }}
                      placeholder={t(canKeepRelayApiKey ? 'settings:aiProviders.dialog.replaceApiKeyHelp' : 'imageGeneration.openAiRelay.apiKeyPlaceholder')}
                      className={cn(inputClasses, 'pr-10')}
                      autoComplete="off"
                      data-testid="image-generation-relay-api-key"
                      aria-invalid={!!errors.apiKey}
                      aria-describedby={errors.apiKey ? 'image-gen-relay-api-key-error' : undefined}
                    />
                    <button type="button" onClick={() => setShowRelayApiKey(value => !value)} aria-label={t(showRelayApiKey ? 'settings:aiProviders.dialog.hideKey' : 'settings:aiProviders.dialog.showKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showRelayApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.apiKey && <p role="alert" id="image-gen-relay-api-key-error" className="text-sm text-destructive">{errors.apiKey}</p>}
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="image-gen-timeout" className={labelClasses}>{t('imageGeneration.timeout')}</Label>
                  <Input
                    id="image-gen-timeout"
                    type="number"
                    min={1000}
                    step={1000}
                    value={timeoutMs}
                    onChange={event => {
                      setTimeoutMs(event.target.value);
                      setErrors(previous => ({ ...previous, timeout: undefined }));
                    }}
                    className={inputClasses}
                    data-testid="image-generation-timeout"
                    aria-invalid={!!errors.timeout}
                    aria-describedby={errors.timeout ? 'image-gen-timeout-error' : undefined}
                  />
                  {errors.timeout && <p role="alert" id="image-gen-timeout-error" className="text-sm text-destructive">{errors.timeout}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-gen-test-agent" className={labelClasses}>{t('imageGeneration.testAgent')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Select id="image-gen-test-agent" value={testAgentId} onValueChange={setTestAgentId} className={cn(inputClasses, 'min-w-0 flex-1')} disabled={busy} data-testid="image-generation-test-agent">
                      {(snapshot?.agents ?? []).map(agent => <SelectItem key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ` (${t('imageGeneration.defaultAgent')})` : ''}</SelectItem>)}
                    </Select>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleTest()} disabled={testing || !hasConfiguredRelay || dirty} data-testid="image-generation-test-button">
                      {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                      {t(testing ? 'imageGeneration.testing' : 'imageGeneration.testButton')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </fieldset>
        </ModelConfigPanels>
      </ModelConfigDialog>
      <ConfirmDialog open={clearConfirmOpen} title={t('imageGeneration.clearConfirmTitle')} message={t('imageGeneration.clearConfirmMessage')} confirmLabel={t('imageGeneration.clearConfirmAction')} cancelLabel={t('common:actions.cancel')} variant="destructive" onConfirm={handleClear} onCancel={() => setClearConfirmOpen(false)} returnFocusTo={triggerRef.current} />
    </div>
  );
}

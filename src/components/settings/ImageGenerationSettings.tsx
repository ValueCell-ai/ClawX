import { Select, SelectItem } from '@/components/ui/select';
/**
 * Global image generation settings (agents.defaults.mediaModels.image).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  clearImageGenerationSettings,
  fetchImageGenerationSettings,
  runImageGenerationTest,
  saveImageGenerationSettings,
  type ImageGenerationSettingsSnapshot,
} from '@/lib/image-generation';
import { ModelConfigDialog, modelFieldClasses } from './ModelConfigDialog';
import { ModelConfigurationSummary } from './ModelConfigurationSummary';
import { cn } from '@/lib/utils';

const inputClasses = modelFieldClasses;
const labelClasses = 'text-sm text-foreground/80 font-medium';

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
    setSaving(true);
    try {
      const timeoutParsed = timeoutMs.trim() ? Number.parseInt(timeoutMs, 10) : null;
      if (timeoutParsed !== null && (!Number.isFinite(timeoutParsed) || timeoutParsed <= 0)) {
        throw new Error(t('imageGeneration.errors.invalidTimeout'));
      }
      if (!relayBaseUrl.trim()) {
        throw new Error(t('imageGeneration.errors.relayBaseUrlRequired'));
      }
      if (!relayModel.trim()) {
        throw new Error(t('imageGeneration.errors.relayModelRequired'));
      }
      if (relayModel.includes('/')) {
        throw new Error(t('imageGeneration.errors.relayModelInvalid'));
      }
      const existingRelayKeyUsable = snapshot?.openAiRelay?.apiKeyConfigured
        && snapshot.openAiRelay.providerKey !== 'openai';
      if (!relayApiKey.trim() && !existingRelayKeyUsable) {
        throw new Error(t('imageGeneration.errors.relayApiKeyRequired'));
      }
      const next = await saveImageGenerationSettings({
        timeoutMs: timeoutParsed,
        openAiRelayEnabled: true,
        openAiRelayBaseUrl: relayBaseUrl.trim(),
        openAiRelayModel: relayModel.trim(),
        openAiRelayApiKey: relayApiKey.trim() || undefined,
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
    setEditorOpen(true);
  };
  let service = '';
  try { service = snapshot?.openAiRelay.baseUrl ? new URL(snapshot.openAiRelay.baseUrl).host : ''; } catch { /* Preserve editable saved settings. */ }
  const configured = hasConfiguredRelay && Boolean(snapshot?.openAiRelay.apiKeyConfigured || snapshot?.agents.some(agent => agent.configured));
  const busy = saving || clearing;
  return (
    <div data-testid="image-generation-settings" className="space-y-4">
      <ModelConfigurationSummary prefix="image-generation" title={t('imageGeneration.title')} description={t('settings:modelManagement.imageDescription')} model={hasConfiguredRelay ? snapshot?.openAiRelay.model || snapshot?.config.primary || undefined : undefined} service={service} configured={configured} loading={loading} onConfigure={openEditor} triggerRef={triggerRef} />
      <ModelConfigDialog open={editorOpen} onClose={() => setEditorOpen(false)} title={t('imageGeneration.title')} description={t('settings:modelManagement.imageDescription')} testId="image-generation-config-dialog" busy={busy} returnFocusRef={triggerRef}
        footer={<><Button variant="outline" className="h-9" disabled={busy} onClick={() => setEditorOpen(false)}>{t('settings:aiProviders.dialog.cancel')}</Button><Button data-testid="image-generation-save" className="h-9" disabled={busy || !dirty} onClick={() => void handleSave()}>{saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}{t('imageGeneration.save')}</Button></>}
      >
        <fieldset disabled={busy} data-testid="image-generation-settings-surface" className="min-w-0 space-y-4">
          <div data-testid="image-generation-openai-relay" className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="image-gen-relay-base-url">{t('settings:aiProviders.dialog.baseUrl')}</Label><Input id="image-gen-relay-base-url" value={relayBaseUrl} onChange={event => setRelayBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className={inputClasses} data-testid="image-generation-relay-base-url" /></div>
            <div className="space-y-1.5"><Label htmlFor="image-gen-relay-model">{t('imageGeneration.openAiRelay.model')}</Label><Input id="image-gen-relay-model" value={relayModel} onChange={event => setRelayModel(event.target.value)} placeholder="gpt-image-2" className={inputClasses} data-testid="image-generation-relay-model" /><p className="text-xs leading-relaxed text-muted-foreground">{t('imageGeneration.openAiRelay.modelHint')}</p></div>
            <div className="space-y-1.5">
              <Label htmlFor="image-gen-relay-api-key">{snapshot?.openAiRelay.apiKeyConfigured ? t('settings:aiProviders.dialog.replaceApiKey') : t('imageGeneration.openAiRelay.apiKey')}</Label>
              {!snapshot?.openAiRelay.apiKeyConfigured && <p data-testid="image-generation-api-key-status" className="text-xs text-muted-foreground">{t('settings:aiProviders.dialog.apiKeyMissing')}</p>}
              <div className="relative"><Input id="image-gen-relay-api-key" type={showRelayApiKey ? 'text' : 'password'} value={relayApiKey} onChange={event => setRelayApiKey(event.target.value)} placeholder={snapshot?.openAiRelay.apiKeyConfigured && snapshot.openAiRelay.providerKey !== 'openai' ? t('settings:aiProviders.dialog.replaceApiKeyHelp') : t('imageGeneration.openAiRelay.apiKeyPlaceholder')} className={cn(inputClasses, 'pr-10')} autoComplete="off" data-testid="image-generation-relay-api-key" /><button type="button" onClick={() => setShowRelayApiKey(value => !value)} aria-label={t(showRelayApiKey ? 'settings:aiProviders.dialog.hideKey' : 'settings:aiProviders.dialog.showKey')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showRelayApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
              <p data-testid="image-generation-api-key-help" className="text-xs text-muted-foreground">{t('settings:aiProviders.dialog.apiKeyStored')}</p>
            </div>
          </div>
          <details data-testid="image-generation-advanced" className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('settings:aiProviders.dialog.advancedConfig')}</summary><div className="mt-4 space-y-5">
            <p className="text-xs leading-relaxed text-muted-foreground">{t('imageGeneration.openAiRelay.description')}</p>
            <div className="space-y-1.5"><Label htmlFor="image-gen-timeout">{t('imageGeneration.timeout')}</Label><Input id="image-gen-timeout" type="number" min={1000} step={1000} value={timeoutMs} onChange={event => setTimeoutMs(event.target.value)} className={inputClasses} data-testid="image-generation-timeout" /></div>
            <div className="space-y-2"><h3 className={labelClasses}>{t('imageGeneration.agentAuthTitle')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('imageGeneration.agentAuthDesc')}</p><table data-testid="image-generation-agent-auth-table" className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="py-2 font-medium">{t('imageGeneration.agentColumn')}</th><th className="py-2 font-medium">{t('imageGeneration.authColumn')}</th></tr></thead><tbody className="divide-y divide-border">{(snapshot?.agents ?? []).map(agent => <tr key={agent.id} data-testid={`image-generation-agent-row-${agent.id}`}><td className="py-2">{agent.name}{agent.isDefault && <span className="ml-2 text-xs text-muted-foreground">{t('imageGeneration.defaultAgent')}</span>}</td><td className={agent.configured ? 'py-2 text-green-700 dark:text-green-400' : 'py-2 text-muted-foreground'}>{agent.provider ? t(agent.configured ? 'imageGeneration.authConfigured' : 'imageGeneration.authMissing') : '—'}</td></tr>)}</tbody></table></div>
            <div className="space-y-2"><Label htmlFor="image-gen-test-agent">{t('imageGeneration.testAgent')}</Label><div className="flex flex-wrap gap-2"><Select id="image-gen-test-agent" value={testAgentId} onValueChange={setTestAgentId} className={cn(inputClasses, 'min-w-0 flex-1')} data-testid="image-generation-test-agent">{(snapshot?.agents ?? []).map(agent => <SelectItem key={agent.id} value={agent.id}>{agent.name}{agent.isDefault ? ` (${t('imageGeneration.defaultAgent')})` : ''}</SelectItem>)}</Select><Button variant="outline" className="h-9" onClick={() => void handleTest()} disabled={testing || !hasConfiguredRelay || dirty} data-testid="image-generation-test-button">{testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}{t(testing ? 'imageGeneration.testing' : 'imageGeneration.testButton')}</Button></div></div>
            <div className="flex items-center justify-between border-t border-border pt-3"><Button variant="ghost" className="h-8 text-xs" onClick={() => void load()} disabled={loading} data-testid="image-generation-refresh"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />{t('common:actions.refresh')}</Button><Button variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive" disabled={clearing || !hasConfiguredRelay} onClick={() => setClearConfirmOpen(true)} data-testid="image-generation-clear"><Trash2 className="mr-1.5 h-3.5 w-3.5" />{t('imageGeneration.clear')}</Button></div>
          </div></details>
        </fieldset>
        <ConfirmDialog open={clearConfirmOpen} title={t('imageGeneration.clearConfirmTitle')} message={t('imageGeneration.clearConfirmMessage')} confirmLabel={t('imageGeneration.clearConfirmAction')} cancelLabel={t('common:actions.cancel')} variant="destructive" onConfirm={handleClear} onCancel={() => setClearConfirmOpen(false)} />
      </ModelConfigDialog>
    </div>
  );
}

/**
 * Global image generation settings (agents.defaults.imageGenerationModel).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePlus, Loader2, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  fetchImageGenerationProviders,
  fetchImageGenerationSettings,
  runImageGenerationTest,
  saveImageGenerationSettings,
  type ImageGenerationSettingsSnapshot,
} from '@/lib/image-generation';
import { cn } from '@/lib/utils';

const inputClasses =
  'h-[44px] rounded-xl font-mono text-meta bg-transparent border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-sm text-foreground/80 font-bold';

function normalizeFallbacks(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

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
  const { t } = useTranslation('dashboard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [snapshot, setSnapshot] = useState<ImageGenerationSettingsSnapshot | null>(null);
  const [providerOptions, setProviderOptions] = useState<Array<{ id: string; label: string; defaultModel: string }>>([]);

  const [primary, setPrimary] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('180000');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relayBaseUrl, setRelayBaseUrl] = useState('');
  const [relayApiKey, setRelayApiKey] = useState('');
  const [testAgentId, setTestAgentId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, providers] = await Promise.all([
        fetchImageGenerationSettings(),
        fetchImageGenerationProviders().catch(() => []),
      ]);
      setSnapshot(settings);
      setPrimary(settings.config.primary ?? '');
      setFallbackText((settings.config.fallbacks ?? []).join('\n'));
      setTimeoutMs(settings.config.timeoutMs ? String(settings.config.timeoutMs) : '180000');
      setAutoSyncEnabled(settings.autoSyncEnabled);
      setRelayEnabled(settings.openAiRelay?.enabled ?? false);
      setRelayBaseUrl(settings.openAiRelay?.baseUrl ?? '');
      setRelayApiKey('');
      setTestAgentId(settings.defaultAgentId);
      setProviderOptions(
        providers.map((row) => ({
          id: row.id,
          label: row.label || row.id,
          defaultModel: row.defaultModel,
        })),
      );
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
    const fallbacks = normalizeFallbacks(fallbackText.split('\n'));
    const timeoutParsed = timeoutMs.trim() ? Number.parseInt(timeoutMs, 10) : null;
    const savedTimeout = snapshot.config.timeoutMs;
    return (
      (primary.trim() || null) !== (snapshot.config.primary ?? null)
      || JSON.stringify(fallbacks) !== JSON.stringify(snapshot.config.fallbacks ?? [])
      || timeoutParsed !== savedTimeout
      || autoSyncEnabled !== snapshot.autoSyncEnabled
      || relayEnabled !== (snapshot.openAiRelay?.enabled ?? false)
      || relayBaseUrl.trim() !== (snapshot.openAiRelay?.baseUrl ?? '').trim()
      || relayApiKey.trim().length > 0
    );
  }, [snapshot, primary, fallbackText, timeoutMs, autoSyncEnabled, relayEnabled, relayBaseUrl, relayApiKey]);

  const primaryUsesOpenAi = primary.trim().toLowerCase().startsWith('openai/');

  const modelSuggestions = useMemo(() => {
    const refs = new Set<string>();
    for (const row of providerOptions) {
      if (row.defaultModel) {
        refs.add(`${row.id}/${row.defaultModel}`);
      }
    }
    for (const suggestion of snapshot?.suggestions ?? []) {
      if (suggestion.defaultRef) {
        refs.add(suggestion.defaultRef);
      }
    }
    if (primary.trim()) {
      refs.add(primary.trim());
    }
    return [...refs].sort();
  }, [providerOptions, snapshot?.suggestions, primary]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const timeoutParsed = timeoutMs.trim() ? Number.parseInt(timeoutMs, 10) : null;
      if (timeoutParsed !== null && (!Number.isFinite(timeoutParsed) || timeoutParsed <= 0)) {
        throw new Error(t('imageGeneration.errors.invalidTimeout'));
      }
      if (relayEnabled && !relayBaseUrl.trim()) {
        throw new Error(t('imageGeneration.errors.relayBaseUrlRequired'));
      }
      if (relayEnabled && !primaryUsesOpenAi) {
        throw new Error(t('imageGeneration.errors.relayRequiresOpenAiModel'));
      }
      if (relayEnabled && !relayApiKey.trim() && !snapshot?.openAiRelay?.apiKeyConfigured) {
        throw new Error(t('imageGeneration.errors.relayApiKeyRequired'));
      }
      const next = await saveImageGenerationSettings({
        primary: primary.trim() || null,
        fallbacks: normalizeFallbacks(fallbackText.split('\n')),
        timeoutMs: timeoutParsed,
        autoSyncEnabled,
        openAiRelayEnabled: relayEnabled,
        openAiRelayBaseUrl: relayEnabled ? relayBaseUrl.trim() : null,
        openAiRelayApiKey: relayApiKey.trim() || undefined,
      });
      setSnapshot(next);
      setPrimary(next.config.primary ?? '');
      setFallbackText((next.config.fallbacks ?? []).join('\n'));
      setRelayEnabled(next.openAiRelay?.enabled ?? false);
      setRelayBaseUrl(next.openAiRelay?.baseUrl ?? '');
      setRelayApiKey('');
      toast.success(t('imageGeneration.toast.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (dirty) {
      toast.message(t('imageGeneration.toast.saveBeforeTest'));
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

  const applySuggestion = (ref: string) => {
    setPrimary(ref);
  };

  return (
    <div data-testid="image-generation-settings" className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            data-testid="image-generation-settings-title"
            className="text-3xl font-serif text-foreground font-normal tracking-tight flex items-center gap-2"
          >
            <ImagePlus className="h-7 w-7 text-foreground/70" />
            {t('imageGeneration.title')}
          </h2>
          <p className="text-meta text-muted-foreground mt-2 max-w-2xl">
            {t('imageGeneration.description')}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full shrink-0"
          onClick={() => void load()}
          disabled={loading}
          data-testid="image-generation-refresh"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-3xl border border-dashed border-transparent">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-8 rounded-3xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className={labelClasses}>{t('imageGeneration.autoSync')}</Label>
              <p className="text-meta text-muted-foreground mt-1">{t('imageGeneration.autoSyncDesc')}</p>
            </div>
            <Switch
              checked={autoSyncEnabled}
              onCheckedChange={setAutoSyncEnabled}
              data-testid="image-generation-auto-sync"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="image-gen-primary" className={labelClasses}>
              {t('imageGeneration.primaryModel')}
            </Label>
            <Input
              id="image-gen-primary"
              list="image-gen-model-suggestions"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="openai/gpt-image-2"
              className={inputClasses}
              data-testid="image-generation-primary"
            />
            <datalist id="image-gen-model-suggestions">
              {modelSuggestions.map((ref) => (
                <option key={ref} value={ref} />
              ))}
            </datalist>
            {snapshot?.suggestions && snapshot.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {snapshot.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.providerId}
                    type="button"
                    className="text-xs rounded-full px-3 py-1 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    onClick={() => applySuggestion(suggestion.defaultRef)}
                    data-testid={`image-generation-suggestion-${suggestion.providerId}`}
                  >
                    {suggestion.label}
                    {' · '}
                    <span className="font-mono opacity-80">{suggestion.defaultRef}</span>
                    {suggestion.configured ? (
                      <Badge variant="secondary" className="ml-1.5 rounded-full px-1.5 py-0 text-[10px]">
                        {t('imageGeneration.authReady')}
                      </Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 p-5"
            data-testid="image-generation-openai-relay"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className={labelClasses}>{t('imageGeneration.openAiRelay.title')}</Label>
                <p className="text-meta text-muted-foreground mt-1">
                  {t('imageGeneration.openAiRelay.description')}
                </p>
              </div>
              <Switch
                checked={relayEnabled}
                onCheckedChange={(checked) => {
                  setRelayEnabled(checked);
                  if (checked && !primary.trim()) {
                    setPrimary('openai/gpt-image-2');
                  }
                }}
                data-testid="image-generation-relay-enabled"
              />
            </div>

            {relayEnabled ? (
              <div className="space-y-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="image-gen-relay-base-url" className={labelClasses}>
                    {t('imageGeneration.openAiRelay.baseUrl')}
                  </Label>
                  <Input
                    id="image-gen-relay-base-url"
                    value={relayBaseUrl}
                    onChange={(e) => setRelayBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className={inputClasses}
                    data-testid="image-generation-relay-base-url"
                  />
                  <p className="text-tiny text-muted-foreground">
                    {t('imageGeneration.openAiRelay.baseUrlHint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-gen-relay-api-key" className={labelClasses}>
                    {t('imageGeneration.openAiRelay.apiKey')}
                  </Label>
                  <Input
                    id="image-gen-relay-api-key"
                    type="password"
                    value={relayApiKey}
                    onChange={(e) => setRelayApiKey(e.target.value)}
                    placeholder={
                      snapshot?.openAiRelay?.apiKeyConfigured
                        ? t('imageGeneration.openAiRelay.apiKeyPlaceholderConfigured')
                        : t('imageGeneration.openAiRelay.apiKeyPlaceholder')
                    }
                    className={inputClasses}
                    autoComplete="off"
                    data-testid="image-generation-relay-api-key"
                  />
                </div>
                {!primaryUsesOpenAi ? (
                  <p className="text-tiny text-amber-600 dark:text-amber-400">
                    {t('imageGeneration.openAiRelay.primaryMustBeOpenAi')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="image-gen-fallbacks" className={labelClasses}>
              {t('imageGeneration.fallbacks')}
            </Label>
            <textarea
              id="image-gen-fallbacks"
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              placeholder={'google/gemini-3.1-flash-image-preview\nopenrouter/google/gemini-3.1-flash-image-preview'}
              rows={3}
              wrap="off"
              spellCheck={false}
              className={cn(
                inputClasses,
                'h-auto min-h-[88px] w-full py-3 resize-y whitespace-pre overflow-x-auto',
              )}
              data-testid="image-generation-fallbacks"
            />
            <p className="text-tiny text-muted-foreground">{t('imageGeneration.fallbacksHint')}</p>
          </div>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="image-gen-timeout" className={labelClasses}>
              {t('imageGeneration.timeout')}
            </Label>
            <Input
              id="image-gen-timeout"
              type="number"
              min={1000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              className={inputClasses}
              data-testid="image-generation-timeout"
            />
          </div>

          <div className="space-y-3">
            <Label className={labelClasses}>{t('imageGeneration.agentAuthTitle')}</Label>
            <p className="text-meta text-muted-foreground">{t('imageGeneration.agentAuthDesc')}</p>
            <div className="rounded-2xl border border-black/10 dark:border-white/10 overflow-hidden">
              <table className="w-full text-sm" data-testid="image-generation-agent-auth-table">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-left text-meta text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{t('imageGeneration.agentColumn')}</th>
                    <th className="px-4 py-2 font-medium">{t('imageGeneration.authColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot?.agents ?? []).map((agent) => (
                    <tr
                      key={agent.id}
                      className="border-b border-black/5 dark:border-white/5 last:border-0"
                      data-testid={`image-generation-agent-row-${agent.id}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium">{agent.name}</span>
                        {agent.isDefault ? (
                          <Badge variant="outline" className="ml-2 rounded-full text-[10px]">
                            {t('imageGeneration.defaultAgent')}
                          </Badge>
                        ) : null}
                        <span className="block font-mono text-tiny text-muted-foreground mt-0.5">{agent.id}</span>
                      </td>
                      <td className="px-4 py-3">
                        {agent.provider ? (
                          agent.configured ? (
                            <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15">
                              {t('imageGeneration.authConfigured')}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="rounded-full">
                              {t('imageGeneration.authMissing')}
                            </Badge>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-black/10 dark:border-white/10">
            <div className="space-y-2 min-w-[200px]">
              <Label htmlFor="image-gen-test-agent" className={labelClasses}>
                {t('imageGeneration.testAgent')}
              </Label>
              <select
                id="image-gen-test-agent"
                value={testAgentId}
                onChange={(e) => setTestAgentId(e.target.value)}
                className={cn(inputClasses, 'w-full')}
                data-testid="image-generation-test-agent"
              >
                {(snapshot?.agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.isDefault ? ` (${t('imageGeneration.defaultAgent')})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              className="rounded-full h-10"
              onClick={() => void handleTest()}
              disabled={testing || !primary.trim()}
              data-testid="image-generation-test-button"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {testing ? t('imageGeneration.testing') : t('imageGeneration.testButton')}
            </Button>
            <Button
              className="rounded-full h-10"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              data-testid="image-generation-save"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {saving ? t('imageGeneration.saving') : t('imageGeneration.save')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

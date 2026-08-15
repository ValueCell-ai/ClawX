import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { hostApi, type TalkCatalog } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';

type Selection = { provider: string; model: string; speakerVoice?: string };

function modelChoices(provider: TalkCatalog['realtime']['providers'][number] | undefined): string[] {
  if (!provider) return [];
  return provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : [];
}

function selectionFromCatalog(catalog: TalkCatalog, current?: Selection): Selection {
  const providers = catalog.realtime.providers.filter((provider) => provider.configured);
  const provider = providers.find((candidate) => candidate.id === current?.provider)
    ?? providers.find((candidate) => candidate.id === catalog.realtime.activeProvider)
    ?? providers[0];
  const models = modelChoices(provider);
  const model = models.includes(current?.model ?? '')
    ? current!.model
    : models[0] ?? '';
  const speakerVoice = provider?.voices?.includes(current?.speakerVoice ?? '')
    ? current!.speakerVoice
    : provider?.voices?.[0];
  return {
    provider: provider?.id ?? '',
    model,
    ...(speakerVoice ? { speakerVoice } : {}),
  };
}

export function TalkSettings() {
  const { t } = useTranslation('settings');
  const [catalog, setCatalog] = useState<TalkCatalog | null>(null);
  const [selection, setSelection] = useState<Selection>({ provider: '', model: '', speakerVoice: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const nextCatalog = await hostApi.talk.catalog();
      setCatalog(nextCatalog);
      setSelection((current) => selectionFromCatalog(nextCatalog, current));
    } catch (error) {
      toast.error(`${t('talk.loadFailed')}: ${toUserMessage(error)}`);
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const provider = catalog?.realtime.providers.find((candidate) => candidate.id === selection.provider);
  const configuredProviders = catalog?.realtime.providers.filter((candidate) => candidate.configured) ?? [];
  const models = modelChoices(provider);
  const voiceChoices = provider?.voices ?? [];
  const canSave = Boolean(selection.provider && selection.model && (!voiceChoices.length || selection.speakerVoice));

  const handleProviderChange = (providerId: string) => {
    const nextProvider = configuredProviders.find((candidate) => candidate.id === providerId);
    setSelection({
      provider: providerId,
      model: modelChoices(nextProvider)[0] ?? '',
      ...(nextProvider?.voices?.length ? { speakerVoice: nextProvider.voices[0] } : {}),
    });
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await hostApi.talk.updateRealtimeSettings(selection);
      toast.success(t('talk.saved'));
      await load();
    } catch (error) {
      toast.error(`${t('talk.saveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="talk" tabIndex={-1} data-testid="talk-settings" className="space-y-6 scroll-mt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif text-foreground font-normal tracking-tight">{t('talk.title')}</h2>
          <p className="text-meta text-muted-foreground mt-2">{t('talk.description')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full shrink-0"
          onClick={() => void load()}
          disabled={loading || saving}
          data-testid="talk-settings-refresh"
          aria-label={t('talk.refresh')}
        >
          <RefreshCw className={`h-4 w-4${loading ? ' animate-spin' : ''}`} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-2xl">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-5 rounded-2xl border border-black/10 dark:border-white/10 bg-surface-modal p-5">
          <p className="text-meta text-muted-foreground" data-testid="talk-settings-readiness">
            {catalog?.realtime.ready === true ? t('talk.readiness.ready') : t('talk.readiness.unavailable')}
          </p>
          {catalog?.realtime.ready === false && catalog.realtime.reason ? (
            <p className="text-meta text-amber-700 dark:text-amber-400" data-testid="talk-settings-unavailable-reason">
              {catalog.realtime.reason}
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="talk-provider">{t('talk.provider')}</Label>
              <Select
                id="talk-provider"
                value={selection.provider}
                onChange={(event) => handleProviderChange(event.target.value)}
                disabled={configuredProviders.length === 0 || saving}
                data-testid="talk-settings-provider"
              >
                {configuredProviders.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="talk-model">{t('talk.model')}</Label>
              <Select
                id="talk-model"
                value={selection.model}
                onChange={(event) => setSelection((current) => ({ ...current, model: event.target.value }))}
                disabled={!models.length || saving}
                data-testid="talk-settings-model"
              >
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="talk-speaker-voice">{t('talk.speakerVoice')}</Label>
              {voiceChoices.length ? (
                <Select
                  id="talk-speaker-voice"
                  value={selection.speakerVoice ?? ''}
                  onChange={(event) => setSelection((current) => ({ ...current, speakerVoice: event.target.value }))}
                  disabled={saving}
                  data-testid="talk-settings-voice"
                >
                  {voiceChoices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
                </Select>
              ) : (
                <p className="text-meta text-muted-foreground" data-testid="talk-settings-voice-unavailable">
                  {t('talk.voiceUnavailable')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/5 dark:border-white/5 pt-4">
            <a
              href="#/settings?section=developer"
              className="text-tiny text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              data-testid="talk-settings-developer-link"
            >
              {t('talk.developerGuidance')}
            </a>
            <Button
              type="button"
              className="rounded-full"
              onClick={() => void handleSave()}
              disabled={!canSave || saving}
              data-testid="talk-settings-save"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {saving ? t('talk.saving') : t('talk.save')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

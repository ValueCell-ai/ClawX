import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { buildConfiguredModelOptions } from '@/lib/model-options';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';
import { ModelPicker } from '@/components/common/ModelPicker';
import { useProviderStore } from '@/stores/providers';
import { toast } from 'sonner';

export function ModelDefaultSummary({ accounts, statuses, vendors, defaultAccountId, onModelLoaded }: {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
  onModelLoaded: (model: string | null) => void;
}) {
  const { t } = useTranslation('settings');
  const [model, setModel] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const setDefaultModel = useProviderStore(store => store.setDefaultModel);
  useEffect(() => {
    let mounted = true;
    void hostApi.agents.list().then(snapshot => {
      if (!snapshot.success) throw new Error('Default model unavailable');
      if (mounted) { setModel(snapshot.defaultModelRef ?? null); onModelLoaded(snapshot.defaultModelRef ?? null); setState('ready'); }
    }).catch(() => { if (mounted) setState('error'); });
    return () => { mounted = false; };
  }, [onModelLoaded, defaultAccountId]);
  const options = useMemo(() => buildConfiguredModelOptions(accounts, statuses, vendors, defaultAccountId), [accounts, statuses, vendors, defaultAccountId]);
  const selectedOption = options.find(option => option.modelRef === model);
  const selectModel = async (ref: string) => {
    const option = options.find(option => option.modelRef === ref);
    if (!option || saving || ref === model) return;
    setSaving(true);
    try {
      const saved = await setDefaultModel(option.accountId, option.modelId);
      setModel(saved);
      onModelLoaded(saved);
      toast.success(t('modelManagement.defaultSaved'));
    } catch (error) {
      toast.error(t('modelManagement.defaultSaveFailed', { error: String(error) }));
      // Auth/account persistence can fail after native config was committed.
      // Reconcile the displayed value rather than claiming the old model is still active.
      try {
        const current = await hostApi.agents.list();
        if (current.success) {
          setModel(current.defaultModelRef ?? null);
          onModelLoaded(current.defaultModelRef ?? null);
        } else { setState('error'); }
      } catch { setState('error'); }
    } finally {
      setSaving(false);
      requestAnimationFrame(() => pickerRef.current?.focus());
    }
  };
  return (
    <div data-testid="models-default-summary" className="flex items-start gap-3 py-1" aria-live="polite">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <span id="models-global-default-label" className="text-xs text-muted-foreground">{t('modelManagement.globalDefault')}</span>
        {selectedOption && <span className="ml-2 text-xs text-muted-foreground">{selectedOption.providerName}</span>}
        <div data-testid="models-default-value" className="mt-1.5 flex max-w-sm items-center gap-2">
          {state !== 'ready' ? <p className="text-sm">{t(state === 'loading' ? 'modelManagement.loading' : 'modelManagement.defaultUnavailable')}</p> : <ModelPicker
            ref={pickerRef} labelledBy="models-global-default-label" testIdPrefix="global-model-picker"
            options={options} value={model} label={selectedOption?.modelId || model || t('modelManagement.defaultUnset')}
            title={t('modelManagement.globalDefault')} onValueChange={ref => void selectModel(ref)} busy={saving}
            side="bottom" align="start"
            className="h-9 w-full max-w-none border border-input bg-surface-modal px-3 text-sm font-normal text-foreground sm:max-w-none"
          />}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('modelManagement.globalDefaultHint')}</p>
      </div>
    </div>
  );
}

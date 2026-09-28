import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComputerUseStatus } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export function ComputerUse() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [permissionRequestCompleted, setPermissionRequestCompleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void hostApi.computerUse.status().then((next) => {
        if (!cancelled) setStatus(next);
      }).catch(() => { if (!cancelled) setFailed(true); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  const run = async (operation: () => Promise<ComputerUseStatus>, requestingPermissions = false) => {
    setBusy(true);
    setFailed(false);
    setPermissionRequestCompleted(false);
    try {
      setStatus(await operation());
      setPermissionRequestCompleted(requestingPermissions);
    } catch {
      setFailed(true);
      // A failed reconciliation may still have persisted a safe disabled state.
      try { setStatus(await hostApi.computerUse.status()); } catch { /* Keep the last snapshot. */ }
    } finally {
      setBusy(false);
    }
  };
  const permissions = status?.permissions;
  const granted = permissions?.accessibility && permissions.screenRecording === 'granted';
  const runtimeState = !status?.enabled ? 'off' : status.running ? 'running' : 'unavailable';

  return (
    <div className="flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden" data-testid="computer-use-page">
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 md:p-8">
      <header className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
        <div>
        <h1 className="text-2xl font-sans text-foreground mb-1 font-medium tracking-normal">{t('computerUse.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('computerUse.description')}</p>
        </div>
        <Button variant="outline" size="sm" className="md:mt-2 self-start" disabled={busy} onClick={() => void run(hostApi.computerUse.status)}><RefreshCw className="h-4 w-4 mr-2" />{t('actions.refresh')}</Button>
      </header>
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 -mr-2 space-y-4">
      {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('computerUse.error')}</p>}
      <section className="space-y-4 rounded-xl border border-black/10 dark:border-white/10 bg-surface-modal p-4" aria-busy={busy}>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="computer-use-enabled" className="font-medium">{t('computerUse.enable')}</label>
          <Switch id="computer-use-enabled" data-testid="computer-use-toggle" checked={status?.enabled ?? false}
            disabled={busy || !status || (!status.supported && !status.enabled)}
            onCheckedChange={(enabled) => void run(() => hostApi.computerUse.setEnabled(enabled))} />
        </div>
        <p className="text-sm text-muted-foreground">{t('computerUse.warning')}</p>
        <p className="text-sm" data-testid="computer-use-runtime" role="status">{t(`computerUse.${runtimeState}`)}</p>
        {status && !status.supported && <p className="text-sm text-muted-foreground">{t('computerUse.unsupported')}</p>}
      </section>
      {permissions && (
        <section className="space-y-4 rounded-xl border border-black/10 dark:border-white/10 bg-surface-modal p-4">
          <h2 className="text-lg font-sans font-medium tracking-normal">{t('computerUse.permissions')}</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{t('computerUse.accessibility')}</dt>
              <dd data-testid="computer-use-accessibility">{t(`computerUse.${permissions.accessibility ? 'granted' : 'notGranted'}`)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{t('computerUse.screenRecording')}</dt>
              <dd data-testid="computer-use-screen-recording">{t(`computerUse.${permissions.screenRecording === 'granted' ? 'granted' : 'notGranted'}`)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground" data-testid="computer-use-permission-hint">{t('computerUse.permissionHint')}</p>
          <Button data-testid="computer-use-request-permissions" variant="outline"
            disabled={busy || !status?.enabled || !status.supported || Boolean(granted)}
            onClick={() => void run(hostApi.computerUse.requestPermissions, true)}>{t('computerUse.request')}</Button>
          {permissionRequestCompleted && status?.enabled && !granted && (
            <p role="status" data-testid="computer-use-permission-feedback" className="text-sm text-amber-700 dark:text-amber-400">
              {t('computerUse.permissionRequestIncomplete')}
            </p>
          )}
        </section>
      )}
      </div>
      </div>
    </div>
  );
}

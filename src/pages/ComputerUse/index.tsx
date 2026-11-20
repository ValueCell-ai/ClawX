import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { ComputerUseStatus } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accessibility, Monitor, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export function ComputerUse({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation(['common', 'settings']);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [permissionRequestCompleted, setPermissionRequestCompleted] = useState(false);
  const snapshotVersion = useRef(0);

  useEffect(() => {
    if (!devModeUnlocked) return;
    let cancelled = false;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      const version = ++snapshotVersion.current;
      void hostApi.computerUse.status().then((next) => {
        if (!cancelled && version === snapshotVersion.current) setStatus(next);
      }).catch(() => {
        if (!cancelled && version === snapshotVersion.current) setFailed(true);
      }).finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [devModeUnlocked]);

  const run = async (operation: () => Promise<ComputerUseStatus>, requestingPermissions = false) => {
    setBusy(true);
    setFailed(false);
    setPermissionRequestCompleted(false);
    try {
      const next = await operation();
      ++snapshotVersion.current;
      setStatus(next);
      setPermissionRequestCompleted(requestingPermissions);
    } catch {
      setFailed(true);
      // A failed reconciliation may still have persisted a safe disabled state.
      try {
        const next = await hostApi.computerUse.status();
        ++snapshotVersion.current;
        setStatus(next);
      } catch { /* Keep the last snapshot. */ }
    } finally {
      setBusy(false);
    }
  };
  const permissions = status?.permissions;
  const granted = permissions?.accessibility && permissions.screenRecording === 'granted';
  const transitioning = status?.state === 'starting' || status?.state === 'stopping';
  const runtimeState = !status ? 'loading' : transitioning ? status.state
    : !status.enabled ? 'off' : status.running ? 'running' : 'unavailable';
  const runtimeTone = runtimeState === 'running' ? 'success' : runtimeState === 'unavailable' ? 'warning' : 'secondary';

  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden" : "flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden"} data-testid="computer-use-page">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-6 md:p-8">
        <header className="mb-6 flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <h1 className="mb-1 font-sans text-2xl font-medium tracking-normal text-foreground">{t('computerUse.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('computerUse.description')}</p>
          </div>
          {devModeUnlocked && (
            <Button variant="outline" size="sm" className="self-start md:mt-2" disabled={busy} onClick={() => void run(hostApi.computerUse.status)}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              {t('actions.refresh')}
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 -mr-2">
          {!devModeUnlocked ? (
            <div className="rounded-xl border border-border bg-surface-modal p-4">
              <p className="text-sm text-muted-foreground">{t('settings:navigation.computer-use.developerHint')}</p>
              <Button variant="outline" size="sm" asChild className="mt-3">
                <Link to="/settings/advanced">{t('settings:navigation.openAdvanced')}</Link>
              </Button>
            </div>
          ) : (
            <>
              {failed && <p role="alert" className="text-sm text-destructive">{t('computerUse.error')}</p>}
              <section className="rounded-xl border border-border bg-surface-modal px-4" aria-busy={busy}>
                <div className="flex items-center justify-between gap-4 py-3.5">
                  <label htmlFor="computer-use-enabled" className="text-sm font-medium">{t('computerUse.enable')}</label>
                  <Switch id="computer-use-enabled" data-testid="computer-use-toggle" checked={status?.enabled ?? false}
                    disabled={busy || !status || (!status.supported && !status.enabled)}
                    onCheckedChange={(enabled) => void run(() => hostApi.computerUse.setEnabled(enabled))} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border py-3">
                  <div className="min-w-0 space-y-2">
                    <Badge variant={runtimeTone} role="status" className="font-medium" data-testid="computer-use-runtime">{t(`computerUse.${runtimeState}`)}</Badge>
                    {status?.reason && <p data-testid="computer-use-reason" className="text-sm text-muted-foreground">{t(`computerUse.reasons.${status.reason}`)}</p>}
                    {status && !status.supported && !status.reason && <p className="text-sm text-muted-foreground">{t('computerUse.unsupported')}</p>}
                    {runtimeState === 'running' && <p className="text-sm text-muted-foreground">{t('computerUse.warning')}</p>}
                  </div>
                  {status?.enabled && status.supported && !status.running && !transitioning && (
                    <Button data-testid="computer-use-retry" variant="outline" size="sm" disabled={busy}
                      onClick={() => void run(hostApi.computerUse.retry)}>{t('computerUse.retry')}</Button>
                  )}
                </div>
              </section>
              {permissions && (
                <section className="rounded-xl border border-border bg-surface-modal px-4">
                  <h2 className="py-3.5 font-sans text-base font-medium tracking-normal">{t('computerUse.permissions')}</h2>
                  <dl className="divide-y divide-border border-t border-border text-sm">
                    {[
                      { key: 'accessibility', testId: 'computer-use-accessibility', icon: Accessibility, allowed: permissions.accessibility },
                      { key: 'screenRecording', testId: 'computer-use-screen-recording', icon: Monitor, allowed: permissions.screenRecording === 'granted' },
                    ].map(({ key, testId, icon: Icon, allowed }) => (
                      <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <dt className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{t(`computerUse.${key}`)}</dt>
                        <dd data-testid={testId}><Badge variant={allowed ? 'success' : 'warning'} className="font-medium">{t(`computerUse.${allowed ? 'granted' : 'notGranted'}`)}</Badge></dd>
                      </div>
                    ))}
                  </dl>
                  {!granted && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
                      {permissionRequestCompleted && status?.enabled ? (
                        <p role="status" data-testid="computer-use-permission-feedback" className="text-sm text-amber-700 dark:text-amber-400">
                          {t('computerUse.permissionRequestIncomplete')}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground" data-testid="computer-use-permission-hint">{t('computerUse.permissionHint')}</p>
                      )}
                      <Button data-testid="computer-use-request-permissions" variant="outline" size="sm"
                        disabled={busy || !status?.enabled || !status.supported}
                        onClick={() => void run(hostApi.computerUse.requestPermissions, true)}>{t('computerUse.request')}</Button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

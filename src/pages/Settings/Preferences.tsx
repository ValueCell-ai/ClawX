/**
 * Settings Page
 * Application configuration
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Sun, Moon, Monitor, RefreshCw, ExternalLink, Copy, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { IssueReportExport } from '@/components/settings/IssueReportExport';
import { toUserMessage } from '@/lib/error-message';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import {
  hostApi,
  type OpenClawCompactionReserveResult,
  type OpenClawDoctorResult,
} from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { isGatewayRestarting } from '@/lib/gateway-status';
type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
};

const settingsCardClass = 'min-w-0 rounded-xl border border-border bg-surface-modal px-4';
const settingsHeadingClass = 'py-3.5 font-sans text-base font-medium tracking-normal text-foreground';
const settingsRowsClass = 'divide-y divide-border';

function SettingsRow({ title, description, htmlFor, children }: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3.5">
      <div className="min-w-0">
        {htmlFor ? <Label htmlFor={htmlFor} className="text-sm font-medium">{title}</Label>
          : <p className="text-sm font-medium">{title}</p>}
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsPreferences({ section }: { section: 'general' | 'advanced' | 'about' }) {
  const { t, i18n } = useTranslation('settings');
  const location = useLocation();
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    launchAtStartup,
    setLaunchAtStartup,
    gatewayAutoStart,
    setGatewayAutoStart,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    autoCheckUpdate,
    setAutoCheckUpdate,
    devModeUnlocked,
    setDevModeUnlocked,
    telemetryEnabled,
    setTelemetryEnabled,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [doctorRunningMode, setDoctorRunningMode] = useState<'diagnose' | 'fix' | null>(null);
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);
  const [compactionReserve, setCompactionReserve] = useState<OpenClawCompactionReserveResult | null>(null);

  const handleShowLogs = async () => {
    try {
      const logs = await hostApi.logs.recent(100);
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApi.logs.dir();
      if (logDir) {
        await hostApi.shell.showItemInFolder(logDir);
      }
    } catch {
      // ignore
    }
  };

  const handleRunOpenClawDoctor = async (mode: 'diagnose' | 'fix') => {
    setDoctorRunningMode(mode);
    try {
      const result = await hostApi.app.openClawDoctor(mode);
      setDoctorResult(result);
      if (result.success) {
        toast.success(mode === 'fix' ? t('developer.doctorFixSucceeded') : t('developer.doctorSucceeded'));
      } else {
        toast.error(result.error || (mode === 'fix' ? t('developer.doctorFixFailed') : t('developer.doctorFailed')));
      }
    } catch (error) {
      const message =
        toUserMessage(error) || (mode === 'fix' ? t('developer.doctorFixRunFailed') : t('developer.doctorRunFailed'));
      toast.error(message);
      setDoctorResult({
        mode,
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command: 'openclaw doctor',
        cwd: '',
        durationMs: 0,
        error: message,
      });
    } finally {
      setDoctorRunningMode(null);
    }
  };

  const handleCopyDoctorOutput = async () => {
    if (!doctorResult) return;
    const payload = [
      `command: ${doctorResult.command}`,
      `cwd: ${doctorResult.cwd}`,
      `exitCode: ${doctorResult.exitCode ?? 'null'}`,
      `durationMs: ${doctorResult.durationMs}`,
      '',
      '[stdout]',
      doctorResult.stdout.trim() || '(empty)',
      '',
      '[stderr]',
      doctorResult.stderr.trim() || '(empty)',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(payload);
      toast.success(t('developer.doctorCopied'));
    } catch (error) {
      toast.error(`Failed to copy doctor output: ${String(error)}`);
    }
  };

  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApi.gateway.controlUi();
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, token: result.token, port: result.port });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(`Failed to copy token: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await hostApi.openclaw.getCliCommand();
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [devModeUnlocked, showCliTools]);

  useEffect(() => {
    if (!devModeUnlocked) {
      setCompactionReserve(null);
      return;
    }
    let cancelled = false;
    void hostApi.openclaw.getCompactionReserve()
      .then((result) => {
        if (!cancelled) setCompactionReserve(result);
      })
      .catch(() => {
        if (!cancelled) setCompactionReserve(null);
      });
    return () => {
      cancelled = true;
    };
  }, [devModeUnlocked]);

  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section');
    if (section !== 'developer') return;
    const target = document.getElementById(section);
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [location.search, section]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  useEffect(() => {
    const unsubscribe = hostEvents.onOpenClawCliInstalled((installedPath) => {
      toast.success(`openclaw CLI installed at ${installedPath}`);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsubscribe = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
    return unsubscribe;
  }, [devModeUnlocked]);

  useEffect(() => {
    setProxyEnabledDraft(proxyEnabled);
  }, [proxyEnabled]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const proxySettingsDirty = useMemo(() => {
    return (
      proxyEnabledDraft !== proxyEnabled ||
      proxyServerDraft.trim() !== proxyServer ||
      proxyHttpServerDraft.trim() !== proxyHttpServer ||
      proxyHttpsServerDraft.trim() !== proxyHttpsServer ||
      proxyAllServerDraft.trim() !== proxyAllServer ||
      proxyBypassRulesDraft.trim() !== proxyBypassRules
    );
  }, [
    proxyAllServer,
    proxyAllServerDraft,
    proxyBypassRules,
    proxyBypassRulesDraft,
    proxyEnabled,
    proxyEnabledDraft,
    proxyHttpServer,
    proxyHttpServerDraft,
    proxyHttpsServer,
    proxyHttpsServerDraft,
    proxyServer,
    proxyServerDraft,
  ]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await hostApi.settings.setMany({
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;
    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs = typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<
      string,
      {
        event: string;
        count: number;
        errorCount: number;
        slowCount: number;
        totalDuration: number;
        timedCount: number;
        lastTs: string;
      }
    >();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
        lastTs: entry.ts,
      };

      current.count += 1;
      current.lastTs = entry.ts;

      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs = typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [telemetryEntries]);

  const handleCopyTelemetry = async () => {
    try {
      const serialized = telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n');
      await navigator.clipboard.writeText(serialized);
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(`${t('common:status.error')}: ${String(error)}`);
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleLanguageChange = (nextLanguage: string) => {
    if (nextLanguage === language) return;
    const translateNext = i18n.getFixedT(nextLanguage, 'settings');
    setLanguage(nextLanguage);
    toast.success(translateNext('appearance.menuLanguageUpdated'));
  };

  const gatewayRestarting = isGatewayRestarting(gatewayStatus);
  const gatewayStateLabel = gatewayRestarting ? 'common:gateway.restarting' : `common:status.${gatewayStatus.state}`;

  return (
    <div data-testid="settings-preferences" className="space-y-4">
      {section === 'general' && (
        <section className={cn(settingsCardClass, settingsRowsClass)}>
          <SettingsRow title={t('appearance.theme')}>
            <div role="group" aria-label={t('appearance.theme')} className="flex flex-wrap gap-1">
              {([{ id: 'light', icon: Sun }, { id: 'dark', icon: Moon }, { id: 'system', icon: Monitor }] as const)
                .map(({ id, icon: Icon }) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="sm"
                    aria-pressed={theme === id}
                    className={cn('text-muted-foreground', theme === id && 'bg-black/5 text-foreground dark:bg-white/10')}
                    onClick={() => setTheme(id)}
                  >
                    <Icon aria-hidden="true" className="mr-2 h-4 w-4" />
                    {t(`appearance.${id}`)}
                  </Button>
                ))}
            </div>
          </SettingsRow>
          <SettingsRow title={t('appearance.language')}>
            <div role="group" aria-label={t('appearance.language')} className="flex flex-wrap gap-1">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <Button
                  key={lang.code}
                  variant="ghost"
                  size="sm"
                  aria-pressed={language === lang.code}
                  className={cn('text-muted-foreground', language === lang.code && 'bg-black/5 text-foreground dark:bg-white/10')}
                  onClick={() => handleLanguageChange(lang.code)}
                >
                  {lang.label}
                </Button>
              ))}
            </div>
          </SettingsRow>
          <SettingsRow title={t('appearance.launchAtStartup')} htmlFor="settings-launch-at-startup">
            <Switch id="settings-launch-at-startup" checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
          </SettingsRow>
        </section>
      )}

      {section === 'advanced' && (
        <>
          <section className={settingsCardClass}>
            <h2 className={settingsHeadingClass}>{t('gateway.title')}</h2>
            <div className={cn('border-t border-border', settingsRowsClass)}>
              <SettingsRow title={t('gateway.status')} description={`${t('gateway.port')} ${gatewayStatus.port}`}>
                <Badge role="status" variant={gatewayRestarting ? 'warning' : gatewayStatus.state === 'running' ? 'success' : gatewayStatus.state === 'error' ? 'destructive' : 'secondary'} className="font-medium">
                  {t(gatewayStateLabel)}
                </Badge>
                <Button variant="outline" size="sm" onClick={restartGateway}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {t('common:actions.restart')}
                </Button>
                <Button variant="outline" size="sm" aria-expanded={showLogs} onClick={showLogs ? () => setShowLogs(false) : handleShowLogs}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  {t('gateway.logs')}
                </Button>
              </SettingsRow>
              {showLogs && (
                <div className="py-3.5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t('gateway.appLogs')}</p>
                    <Button variant="ghost" size="sm" onClick={handleOpenLogDir}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      {t('gateway.openFolder')}
                    </Button>
                  </div>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-input p-3 font-mono text-xs text-muted-foreground">
                    {logContent || t('chat:noLogs')}
                  </pre>
                </div>
              )}
              <SettingsRow title={t('gateway.autoStart')} htmlFor="settings-gateway-auto-start">
                <Switch id="settings-gateway-auto-start" checked={gatewayAutoStart} onCheckedChange={setGatewayAutoStart} />
              </SettingsRow>
            </div>
          </section>
          <section className={settingsCardClass} aria-labelledby="settings-privacy-title">
            <h2 id="settings-privacy-title" className={settingsHeadingClass}>{t('advanced.privacy')}</h2>
            <div className="border-t border-border">
              <SettingsRow title={t('advanced.telemetry')} description={t('advanced.telemetryDesc')} htmlFor="settings-telemetry">
                <Switch id="settings-telemetry" checked={telemetryEnabled} onCheckedChange={setTelemetryEnabled} />
              </SettingsRow>
            </div>
          </section>
          <section id="developer" tabIndex={-1} data-testid="settings-developer-section" className={settingsCardClass}>
            <h2 data-testid="settings-developer-title" className={settingsHeadingClass}>{t('developer.title')}</h2>
            <div className="border-t border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div>
                  <Label htmlFor="settings-developer-mode" className="text-sm font-medium">{t('advanced.devMode')}</Label>
                  <p className="mt-1 text-sm text-muted-foreground" data-testid="settings-developer-mode-desc">
                    {t('advanced.devModeDesc')}
                  </p>
                </div>
                <Switch
                  id="settings-developer-mode"
                  checked={devModeUnlocked}
                  onCheckedChange={setDevModeUnlocked}
                  data-testid="settings-dev-mode-switch"
                />
              </div>
            </div>
            {devModeUnlocked && (
              <>
                <Button variant="outline" size="sm" data-testid="settings-open-dev-console"
                  onClick={() => void hostApi.gateway.controlUi().then(async (result) => {
                    if (!result.success || !result.url) throw new Error(result.error || t('developer.consoleUnavailable'));
                    await hostApi.shell.openExternal(result.url);
                  }).catch((error) => toast.error(toUserMessage(error) || t('developer.consoleUnavailable')))}>
                  <ExternalLink className="mr-2 h-4 w-4" />{t('developer.console')}
                </Button>
                <div className="py-4" data-testid="settings-developer-advanced">
                <div className="space-y-8">
                  {/* Network proxy */}
                  <div className="space-y-4" data-testid="settings-proxy-section">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="settings-proxy-enabled" className="text-sm font-medium">{t('gateway.proxyTitle')}</Label>
                        <p className="text-meta text-muted-foreground">{t('gateway.proxyDesc')}</p>
                      </div>
                      <Switch
                        id="settings-proxy-enabled"
                        checked={proxyEnabledDraft}
                        onCheckedChange={setProxyEnabledDraft}
                        data-testid="settings-proxy-toggle"
                      />
                    </div>

                    {proxyEnabledDraft && (
                      <div className="space-y-4 pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="proxy-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyServer')}
                            </Label>
                            <Input
                              id="proxy-server"
                              value={proxyServerDraft}
                              onChange={(event) => setProxyServerDraft(event.target.value)}
                              placeholder="http://127.0.0.1:7890"
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-sm text-muted-foreground">{t('gateway.proxyServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-http-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyHttpServer')}
                            </Label>
                            <Input
                              id="proxy-http-server"
                              value={proxyHttpServerDraft}
                              onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-sm text-muted-foreground">{t('gateway.proxyHttpServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-https-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyHttpsServer')}
                            </Label>
                            <Input
                              id="proxy-https-server"
                              value={proxyHttpsServerDraft}
                              onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-sm text-muted-foreground">{t('gateway.proxyHttpsServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-all-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyAllServer')}
                            </Label>
                            <Input
                              id="proxy-all-server"
                              value={proxyAllServerDraft}
                              onChange={(event) => setProxyAllServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-sm text-muted-foreground">{t('gateway.proxyAllServerHelp')}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-bypass" className="text-meta text-foreground/80">
                            {t('gateway.proxyBypass')}
                          </Label>
                          <Input
                            id="proxy-bypass"
                            value={proxyBypassRulesDraft}
                            onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
                            placeholder="<local>;localhost;127.0.0.1;::1"
                            className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                          />
                          <p className="text-sm text-muted-foreground">{t('gateway.proxyBypassHelp')}</p>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Button
                        variant="outline"
                        onClick={handleSaveProxySettings}
                        disabled={savingProxy || !proxySettingsDirty}
                        data-testid="settings-proxy-save-button"
                        size="sm"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2${savingProxy ? ' animate-spin' : ''}`} />
                        {savingProxy ? t('common:status.saving') : t('common:actions.save')}
                      </Button>
                      <p className="text-xs text-muted-foreground">{t('gateway.proxyRestartNote')}</p>
                    </div>
                  </div>
                  <div className="space-y-4 pt-4">
                    <Label className="text-sm font-medium text-foreground/80">{t('developer.gatewayToken')}</Label>
                    <p className="text-meta text-muted-foreground">{t('developer.gatewayTokenDesc')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        data-testid="settings-developer-gateway-token"
                        readOnly
                        value={controlUiInfo?.token || ''}
                        placeholder={t('developer.tokenUnavailable')}
                        className="h-9 min-w-[200px] flex-1 border-transparent bg-surface-input font-mono text-meta"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={refreshControlUiInfo}
                        disabled={!devModeUnlocked}
                        className="h-9 px-3"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {t('common:actions.load')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCopyGatewayToken}
                        disabled={!controlUiInfo?.token}
                        className="h-9 px-3"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2" data-testid="settings-developer-compaction-reserve">
                    <Label className="text-sm font-medium text-foreground/80">{t('developer.compactionReserve')}</Label>
                    <p className="text-meta text-muted-foreground">{t('developer.compactionReserveDesc')}</p>
                    <Input
                      readOnly
                      value={compactionReserve?.reserveTokensFloor?.toLocaleString() || ''}
                      placeholder={t('developer.compactionReserveUnavailable')}
                      className="h-9 border-transparent bg-surface-input font-mono text-meta"
                    />
                  </div>

                  {showCliTools && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-foreground">{t('developer.cli')}</Label>
                      <p className="text-meta text-muted-foreground">{t('developer.cliDesc')}</p>
                      {isWindows && <p className="text-xs text-muted-foreground">{t('developer.cliPowershell')}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Input
                          readOnly
                          value={openclawCliCommand}
                          placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="h-9 min-w-[200px] flex-1 border-transparent bg-surface-input font-mono text-meta"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyCliCommand}
                          disabled={!openclawCliCommand}
                          className="h-9 px-3"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.doctor')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">{t('developer.doctorDesc')}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('diagnose')}
                          disabled={doctorRunningMode !== null}
                          className="h-9 px-3"
                        >
                          <RefreshCw
                            className={`h-4 w-4 mr-2${doctorRunningMode === 'diagnose' ? ' animate-spin' : ''}`}
                          />
                          {doctorRunningMode === 'diagnose' ? t('common:status.running') : t('developer.runDoctor')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('fix')}
                          disabled={doctorRunningMode !== null}
                          className="h-9 px-3"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'fix' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'fix' ? t('common:status.running') : t('developer.runDoctorFix')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyDoctorOutput}
                          disabled={!doctorResult}
                          className="h-9 px-3"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>

                    {doctorResult && (
                      <div className="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-4 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge
                            variant={doctorResult.success ? 'secondary' : 'destructive'}
                            className="rounded-full px-3 py-1"
                          >
                            {doctorResult.mode === 'fix'
                              ? doctorResult.success
                                ? t('developer.doctorFixOk')
                                : t('developer.doctorFixIssue')
                              : doctorResult.success
                                ? t('developer.doctorOk')
                                : t('developer.doctorIssue')}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorExitCode')}: {doctorResult.exitCode ?? 'null'}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorDuration')}: {Math.round(doctorResult.durationMs)}ms
                          </Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground font-mono break-all">
                          <p>
                            {t('developer.doctorCommand')}: {doctorResult.command}
                          </p>
                          <p>
                            {t('developer.doctorWorkingDir')}: {doctorResult.cwd || '-'}
                          </p>
                          {doctorResult.error && (
                            <p>
                              {t('developer.doctorError')}: {doctorResult.error}
                            </p>
                          )}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStdout')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-meta font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stdout.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStderr')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-meta font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stderr.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.telemetryViewer')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">{t('developer.telemetryViewerDesc')}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTelemetryViewer((prev) => !prev)}
                        className="rounded-md px-3 h-9 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        {showTelemetryViewer ? t('common:actions.hide') : t('common:actions.show')}
                      </Button>
                    </div>

                    {showTelemetryViewer && (
                      <div className="space-y-4 rounded-xl border border-black/10 dark:border-white/10 p-4 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="rounded-full px-3 py-1 bg-surface-modal border border-black/5 dark:border-white/5"
                          >
                            {t('developer.telemetryTotal')}: {telemetryStats.total}
                          </Badge>
                          <Badge
                            variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'}
                            className={cn(
                              'rounded-full px-3 py-1',
                              telemetryStats.errorCount === 0 &&
                                'bg-surface-modal border border-black/5 dark:border-white/5',
                            )}
                          >
                            {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                          </Badge>
                          <Badge
                            variant={telemetryStats.slowCount > 0 ? 'secondary' : 'outline'}
                            className={cn(
                              'rounded-full px-3 py-1',
                              telemetryStats.slowCount === 0 &&
                                'bg-surface-modal border border-black/5 dark:border-white/5',
                            )}
                          >
                            {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                          </Badge>
                          <div className="ml-auto flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCopyTelemetry}
                              className="h-8"
                            >
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              {t('common:actions.copy')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleClearTelemetry}
                              className="h-8"
                            >
                              {t('common:actions.clear')}
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-80 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-modal shadow-inner">
                          {telemetryByEvent.length > 0 && (
                            <div className="border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3">
                              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                                {t('developer.telemetryAggregated')}
                              </p>
                              <div className="space-y-1.5 text-xs">
                                {telemetryByEvent.map((item) => (
                                  <div
                                    key={item.event}
                                    className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded-lg border border-black/5 dark:border-white/5 bg-surface-modal px-3 py-2"
                                  >
                                    <span className="truncate font-medium" title={item.event}>
                                      {item.event}
                                    </span>
                                    <span className="text-muted-foreground">n={item.count}</span>
                                    <span className="text-muted-foreground">
                                      avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms
                                    </span>
                                    <span className="text-muted-foreground">slow={item.slowCount}</span>
                                    <span className="text-muted-foreground">err={item.errorCount}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2 p-3 font-mono text-xs">
                            {telemetryEntries.length === 0 ? (
                              <div className="text-muted-foreground text-center py-4">
                                {t('developer.telemetryEmpty')}
                              </div>
                            ) : (
                              telemetryEntries
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-lg border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3"
                                  >
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <span className="font-semibold text-foreground">{entry.event}</span>
                                      <span className="text-muted-foreground text-meta">{entry.ts}</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap text-meta text-muted-foreground overflow-x-auto">
                                      {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                                    </pre>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              </>
            )}
          </section>
        </>
      )}

      {section === 'about' && (
        <>
          <section className={settingsCardClass}>
            <h2 className={settingsHeadingClass}>{t('updates.title')}</h2>
            <div className={cn('border-t border-border', settingsRowsClass)}>
              <UpdateSettings />
              <SettingsRow title={t('updates.autoCheck')} htmlFor="settings-auto-check-update">
                <Switch id="settings-auto-check-update" checked={autoCheckUpdate} onCheckedChange={setAutoCheckUpdate} />
              </SettingsRow>
            </div>
          </section>
          <section className={settingsCardClass} data-testid="settings-support-section">
            <h2 className={settingsHeadingClass}>{t('support.title')}</h2>
            <div className="border-t border-border">
              <SettingsRow title={t('about.appName')} description={t('about.basedOn')}>
                <Button variant="outline" size="sm" onClick={() => window.electron.openExternal('https://claw-x.com')}>
                  {t('about.docs')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.electron.openExternal('https://github.com/ValueCell-ai/ClawX')}>
                  {t('about.github')}
                </Button>
                <Button variant="outline" size="sm" onClick={() =>
                  window.electron.openExternal('https://icnnp7d0dymg.feishu.cn/wiki/UyfOwQ2cAiJIP6kqUW8cte5Bnlc')}>
                  {t('about.faq')}
                </Button>
              </SettingsRow>
            </div>
            <div className="border-t border-border py-3.5">
              <IssueReportExport />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default SettingsPreferences;

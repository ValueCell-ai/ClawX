import { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ExternalLink,
  FileJson,
  FileText,
  ListChecks,
  Loader2,
  ScrollText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getSessionDisplayTitle } from '@shared/chat/session-title';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { shouldRetainSessionInCatalog } from '@/stores/chat/session-key-utils';

export function IssueReportExport() {
  const { t } = useTranslation(['settings', 'common']);
  const sessions = useChatStore((state) => state.sessions);
  const sessionLabels = useChatStore((state) => state.sessionLabels);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const loadSessions = useChatStore((state) => state.loadSessions);
  const [open, setOpen] = useState(false);
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState('');
  const [skippedSessionCount, setSkippedSessionCount] = useState(0);
  const [error, setError] = useState('');

  const availableSessions = useMemo(() => sessions
    .filter(shouldRetainSessionInCatalog)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .map((session) => ({
      key: session.key,
      label: getSessionDisplayTitle(session, sessionLabels),
    })), [sessionLabels, sessions]);

  const availableSessionKeys = useMemo(
    () => new Set(availableSessions.map((session) => session.key)),
    [availableSessions],
  );
  const selectedSet = useMemo(
    () => new Set(selectedSessionKeys.filter((key) => availableSessionKeys.has(key))),
    [availableSessionKeys, selectedSessionKeys],
  );
  const allSelected = availableSessions.length > 0
    && availableSessions.every((session) => selectedSet.has(session.key));

  const handleOpen = () => {
    const defaultKey = availableSessions.some((session) => session.key === currentSessionKey)
      ? currentSessionKey
      : availableSessions[0]?.key;
    setSelectedSessionKeys(defaultKey ? [defaultKey] : []);
    setExportedPath('');
    setSkippedSessionCount(0);
    setError('');
    setOpen(true);
    void loadSessions().catch(() => undefined);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (exporting && !nextOpen) return;
    setOpen(nextOpen);
  };

  const toggleSession = (sessionKey: string) => {
    setSelectedSessionKeys((current) => current.includes(sessionKey)
      ? current.filter((key) => key !== sessionKey)
      : [...current, sessionKey]);
  };

  const toggleAll = () => {
    setSelectedSessionKeys(allSelected ? [] : availableSessions.map((session) => session.key));
  };

  const handleExport = async () => {
    if (selectedSet.size === 0 || exporting) return;
    setExporting(true);
    setError('');
    try {
      const result = await hostApi.diagnostics.exportIssueReport({ sessionKeys: [...selectedSet] });
      if (!result.success || !result.path) throw new Error(result.error || 'Export failed');
      setExportedPath(result.path);
      setSkippedSessionCount(result.skippedSessionKeys?.length ?? 0);
      toast.success(t('settings:issueReport.exportSucceeded'));
    } catch (exportError) {
      console.error('Failed to export issue report:', exportError);
      setError(t('settings:issueReport.exportFailed'));
      toast.error(t('settings:issueReport.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleReveal = async () => {
    if (!exportedPath) return;
    try {
      await hostApi.shell.showItemInFolder(exportedPath);
    } catch (revealError) {
      console.error('Failed to reveal issue report:', revealError);
      toast.error(t('settings:issueReport.revealFailed'));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{t('settings:issueReport.actionTitle')}</p>
          <p className="mt-1 text-meta text-muted-foreground">{t('settings:issueReport.actionDescription')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleOpen}
          data-testid="settings-issue-report-open"
          className="shrink-0 rounded-xl border-black/10 bg-transparent dark:border-white/10"
        >
          <Archive className="mr-2 h-4 w-4" />
          {t('settings:issueReport.open')}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          data-testid="issue-report-dialog"
          className="max-w-2xl overflow-hidden rounded-3xl border border-black/10 bg-surface-modal p-0 shadow-2xl dark:border-white/10"
        >
          <div className="space-y-1 border-b border-black/5 px-6 py-5 dark:border-white/5">
            <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
              {exportedPath
                ? t('settings:issueReport.completeTitle')
                : t('settings:issueReport.dialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {exportedPath
                ? t('settings:issueReport.completeDescription')
                : t('settings:issueReport.dialogDescription')}
            </DialogDescription>
          </div>

          {exportedPath ? (
            <div className="space-y-5 px-6 py-5">
              <div className="flex items-start gap-3 rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-700 dark:text-green-400" />
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {t('settings:issueReport.exportSucceeded')}
                  </p>
                  <p
                    className="break-all rounded-lg bg-surface-input px-3 py-2 font-mono text-xs text-foreground"
                    data-testid="issue-report-path"
                    title={exportedPath}
                  >
                    {exportedPath}
                  </p>
                </div>
              </div>
              {skippedSessionCount > 0 && (
                <p
                  className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400"
                  data-testid="issue-report-skipped-sessions"
                >
                  {t('settings:issueReport.skippedSessions', { count: skippedSessionCount })}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="ghost">{t('common:actions.close')}</Button>
                </DialogClose>
                <Button type="button" onClick={() => void handleReveal()} data-testid="issue-report-reveal">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t('settings:issueReport.showInFolder')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
              <section aria-labelledby="issue-report-contents-title" className="space-y-3">
                <h3 id="issue-report-contents-title" className="text-sm font-semibold text-foreground">
                  {t('settings:issueReport.contentsTitle')}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2" data-testid="issue-report-contents">
                  {[
                    { icon: FileText, key: 'transcripts' },
                    { icon: FileJson, key: 'config' },
                    { icon: ScrollText, key: 'logs' },
                    { icon: ListChecks, key: 'manifest' },
                  ].map(({ icon: Icon, key }) => (
                    <div key={key} className="flex items-start gap-3 rounded-xl bg-black/5 p-3 dark:bg-white/5">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t(`settings:issueReport.contents.${key}.title`)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t(`settings:issueReport.contents.${key}.description`)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="issue-report-sessions-title" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="issue-report-sessions-title" className="text-sm font-semibold text-foreground">
                    {t('settings:issueReport.sessionsTitle')}
                  </h3>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={availableSessions.length === 0}
                      data-testid="issue-report-select-all"
                      className="rounded border-black/20 text-blue-500 focus:ring-blue-500/50 dark:border-white/20"
                    />
                    {t('settings:issueReport.selectAll', { count: availableSessions.length })}
                  </label>
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-black/10 bg-surface-input p-2 dark:border-white/10">
                  {availableSessions.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                      {t('settings:issueReport.noSessions')}
                    </p>
                  ) : availableSessions.map((session) => (
                    <label
                      key={session.key}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(session.key)}
                        onChange={() => toggleSession(session.key)}
                        data-testid={`issue-report-session-${session.key}`}
                        className="rounded border-black/20 text-blue-500 focus:ring-blue-500/50 dark:border-white/20"
                      />
                      <span className="min-w-0 truncate text-sm text-foreground">{session.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground" data-testid="issue-report-selection-count">
                  {t('settings:issueReport.selectedCount', { count: selectedSet.size })}
                </p>
              </section>

              {error && (
                <p className="text-sm text-red-700 dark:text-red-400" role="alert" data-testid="issue-report-error">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button type="button" variant="ghost" disabled={exporting}>
                    {t('common:actions.cancel')}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  disabled={selectedSet.size === 0 || exporting}
                  onClick={() => void handleExport()}
                  data-testid="issue-report-export"
                >
                  {exporting
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <Archive className="mr-2 h-4 w-4" />}
                  {exporting
                    ? t('settings:issueReport.exporting')
                    : t('settings:issueReport.export', { count: selectedSet.size })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

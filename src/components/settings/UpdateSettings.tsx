/**
 * Update Settings Component
 * Displays update status and allows manual update checking/installation
 */
import { useEffect, useCallback } from 'react';
import { Download, RefreshCw, Loader2, Rocket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useUpdateStore } from '@/stores/update';
import { useTranslation } from 'react-i18next';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UpdateSettings() {
  const { t } = useTranslation('settings');
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    autoInstallCountdown,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    cancelAutoInstall,
    clearError,
  } = useUpdateStore();

  // Initialize on mount
  useEffect(() => {
    init();
  }, [init]);

  const handleCheckForUpdates = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const canCheckForUpdates = !import.meta.env.DEV;

  const renderStatusText = () => {
    if (!canCheckForUpdates) return t('updates.status.devUnavailable');
    if (status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0) {
      return t('updates.status.autoInstalling', { seconds: autoInstallCountdown });
    }
    switch (status) {
      case 'checking':
        return t('updates.status.checking');
      case 'downloading':
        return t('updates.status.downloading');
      case 'available':
        return t('updates.status.available', { version: updateInfo?.version });
      case 'downloaded':
        return t('updates.status.downloaded', { version: updateInfo?.version });
      case 'error':
        return t('updates.status.failed');
      case 'not-available':
        return t('updates.status.latest');
      default:
        return null;
    }
  };

  const renderAction = () => {
    switch (status) {
      case 'checking':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.checking')}
          </Button>
        );
      case 'downloading':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t('updates.action.downloading')}
          </Button>
        );
      case 'available':
        return (
          <Button onClick={downloadUpdate} size="sm">
            <Download className="h-4 w-4 mr-2" />
            {t('updates.action.download')}
          </Button>
        );
      case 'downloaded':
        if (autoInstallCountdown != null && autoInstallCountdown >= 0) {
          return (
            <Button onClick={cancelAutoInstall} size="sm" variant="outline">
              <XCircle className="h-4 w-4 mr-2" />
              {t('updates.action.cancelAutoInstall')}
            </Button>
          );
        }
        return (
          <Button onClick={installUpdate} size="sm" variant="default">
            <Rocket className="h-4 w-4 mr-2" />
            {t('updates.action.install')}
          </Button>
        );
      case 'error':
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.retry')}
          </Button>
        );
      default:
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('updates.action.check')}
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 py-3.5 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('common:status.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('updates.currentVersion')} <span className="ml-1 tabular-nums" data-testid="settings-current-version">v{currentVersion}</span>
          </p>
          <p className="text-sm text-muted-foreground empty:hidden" role="status">{renderStatusText()}</p>
        </div>
        {canCheckForUpdates && renderAction()}
      </div>

      {/* Download Progress */}
      {canCheckForUpdates && status === 'downloading' && progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
            </span>
            <span>{formatBytes(progress.bytesPerSecond)}/s</span>
          </div>
          <Progress value={progress.percent} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            {t('updates.status.progress', { percent: Math.round(progress.percent) })}
          </p>
        </div>
      )}

      {/* Update Info */}
      {canCheckForUpdates && updateInfo && (status === 'available' || status === 'downloaded') && (
        <div className="rounded-lg bg-surface-input p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">{t('about.version', { version: updateInfo.version })}</p>
            {updateInfo.releaseDate && (
              <p className="text-sm text-muted-foreground">
                {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>
          {updateInfo.releaseNotes && (
            <div className="text-sm text-muted-foreground prose prose-sm max-w-none">
              <p className="font-medium text-foreground mb-1">{t('updates.whatsNew')}</p>
              <p className="whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Error Details */}
      {canCheckForUpdates && status === 'error' && error && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{t('updates.errorDetails')}</summary>
          <p className="mt-2 break-words rounded-lg bg-surface-input p-3">{error}</p>
        </details>
      )}
    </div>
  );
}

export default UpdateSettings;

/**
 * Update Settings Component
 * Displays update status and allows manual update checking/installation
 */
import { useEffect, useCallback } from 'react';
import { Download, RefreshCw, Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useUpdateStore } from '@/stores/update';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UpdateSettings() {
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
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

  const renderStatusText = () => {
    switch (status) {
      case 'checking':
        return 'Checking for updates...';
      case 'downloading':
        return 'Downloading update...';
      case 'available':
        return `Update available: v${updateInfo?.version}`;
      case 'downloaded':
        return `Ready to install: v${updateInfo?.version}`;
      case 'error':
        return 'Update check failed';
      case 'not-available':
        return 'You have the latest version';
      default:
        return 'Check for updates to get the latest features';
    }
  };

  const renderAction = () => {
    switch (status) {
      case 'checking':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Checking...
          </Button>
        );
      case 'downloading':
        return (
          <Button disabled variant="outline" size="sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Downloading...
          </Button>
        );
      case 'available':
        return (
          <Button onClick={downloadUpdate} size="sm">
            <Download className="h-4 w-4 mr-2" />
            Download Update
          </Button>
        );
      case 'downloaded':
        return (
          <Button onClick={installUpdate} size="sm" variant="default">
            <Rocket className="h-4 w-4 mr-2" />
            Install & Restart
          </Button>
        );
      case 'error':
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        );
      default:
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Check for Updates
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Version */}
      <div className="space-y-1">
        <p className="text-sm font-medium">Current Version</p>
        <p className="text-2xl font-bold">v{currentVersion}</p>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between py-3 border-t border-b">
        <p className="text-sm text-muted-foreground">{renderStatusText()}</p>
        {renderAction()}
      </div>

      {/* Download Progress */}
      {status === 'downloading' && progress && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
            </span>
            <span>{formatBytes(progress.bytesPerSecond)}/s</span>
          </div>
          <Progress value={progress.percent} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            {Math.round(progress.percent)}% complete
          </p>
        </div>
      )}

      {/* Update Info */}
      {updateInfo && (status === 'available' || status === 'downloaded') && (
        <div className="rounded-lg bg-muted p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">Version {updateInfo.version}</p>
            {updateInfo.releaseDate && (
              <p className="text-sm text-muted-foreground">
                {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>
          {updateInfo.releaseNotes && (
            <div className="text-sm text-muted-foreground prose prose-sm max-w-none">
              <p className="font-medium text-foreground mb-1">What's New:</p>
              <p className="whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
            </div>
          )}
        </div>
      )}

      {/* Error Details */}
      {status === 'error' && error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/10 p-4 text-red-600 dark:text-red-400 text-sm">
          <p className="font-medium mb-1">Error Details:</p>
          <p>{error}</p>
        </div>
      )}

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        Updates are downloaded in the background and installed when you restart the app.
      </p>
    </div>
  );
}

export default UpdateSettings;

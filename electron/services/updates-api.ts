import type {
  UpdateInfoSnapshot,
  UpdateProgressSnapshot,
  UpdateStatusSnapshot,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { AppUpdater, UpdateStatus } from '../main/updater';

function normalizeInfo(info: UpdateStatus['info']): UpdateInfoSnapshot | undefined {
  if (!info) return undefined;
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: typeof info.releaseNotes === 'string' || info.releaseNotes == null ? info.releaseNotes : String(info.releaseNotes),
  };
}

function normalizeProgress(progress: UpdateStatus['progress']): UpdateProgressSnapshot | undefined {
  if (!progress) return undefined;
  return {
    total: progress.total,
    delta: progress.delta,
    transferred: progress.transferred,
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
  };
}

function normalizeStatus(status: UpdateStatus): UpdateStatusSnapshot {
  return {
    status: status.status,
    info: normalizeInfo(status.info),
    progress: normalizeProgress(status.progress),
    error: status.error,
  };
}

export function createUpdatesApi(updater: AppUpdater): CompleteHostServiceRegistry['updates'] {
  return {
    status: () => normalizeStatus(updater.getStatus()),
    version: () => updater.getCurrentVersion(),
    check: async () => {
      try {
        await updater.checkForUpdates();
        return { success: true, status: normalizeStatus(updater.getStatus()) };
      } catch (error) {
        return { success: false, error: String(error), status: normalizeStatus(updater.getStatus()) };
      }
    },
    download: async () => {
      try {
        await updater.downloadUpdate();
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
    install: () => {
      updater.quitAndInstall();
      return { success: true };
    },
    setChannel: (payload) => {
      updater.setChannel(payload.channel);
      return { success: true };
    },
    setAutoDownload: (payload) => {
      updater.setAutoDownload(payload.enable);
      return { success: true };
    },
    cancelAutoInstall: () => {
      updater.cancelAutoInstall();
      return { success: true };
    },
  };
}

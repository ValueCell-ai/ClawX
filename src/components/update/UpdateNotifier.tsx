import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '@/stores/update';

const AVAILABLE_TOAST_ID = 'clawx-update-available';
const DOWNLOADED_TOAST_ID = 'clawx-update-downloaded';

/**
 * Shows global update prompts outside the Settings page.
 *
 * The update store owns IPC communication; this component only reacts to
 * store state changes and presents user-facing actions.
 */
export function UpdateNotifier() {
  const { t } = useTranslation('settings');
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const downloadUpdate = useUpdateStore((state) => state.downloadUpdate);
  const installUpdate = useUpdateStore((state) => state.installUpdate);
  const lastAvailableVersionRef = useRef<string | null>(null);
  const lastDownloadedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    const version = updateInfo?.version || t('updates.toast.unknownVersion');

    if (status !== 'available') {
      toast.dismiss(AVAILABLE_TOAST_ID);
    }

    if (status !== 'downloaded') {
      toast.dismiss(DOWNLOADED_TOAST_ID);
    }

    if (status === 'available') {
      if (lastAvailableVersionRef.current === version) return;
      lastAvailableVersionRef.current = version;

      toast(t('updates.toast.availableTitle'), {
        id: AVAILABLE_TOAST_ID,
        description: t('updates.toast.availableDescription', { version }),
        duration: Infinity,
        action: {
          label: t('updates.action.download'),
          onClick: () => {
            toast.dismiss(AVAILABLE_TOAST_ID);
            lastAvailableVersionRef.current = null;
            void downloadUpdate();
          },
        },
      });
      return;
    }

    if (status === 'downloaded') {
      if (lastDownloadedVersionRef.current === version) return;
      lastDownloadedVersionRef.current = version;

      toast(t('updates.toast.downloadedTitle'), {
        id: DOWNLOADED_TOAST_ID,
        description: t('updates.toast.downloadedDescription', { version }),
        duration: Infinity,
        action: {
          label: t('updates.action.install'),
          onClick: () => {
            toast.dismiss(DOWNLOADED_TOAST_ID);
            lastDownloadedVersionRef.current = null;
            installUpdate();
          },
        },
      });
    }
  }, [downloadUpdate, installUpdate, status, t, updateInfo?.version]);

  return null;
}

export default UpdateNotifier;

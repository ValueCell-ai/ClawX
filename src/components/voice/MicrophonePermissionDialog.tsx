import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AsrMicrophoneAccessResult } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function MicrophonePermissionDialog({ access, onClose }: {
  access: AsrMicrophoneAccessResult;
  onClose: () => void;
}) {
  const { t } = useTranslation('chat');
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const close = () => { active.current = false; onClose(); };
  const openSettings = async () => {
    if (pending.current || !active.current || !access.canOpenSettings) return;
    pending.current = true;
    setOpening(true);
    setFailed(false);
    try {
      const result = await hostApi.asr.openMicrophoneSettings();
      if (active.current) setFailed(!result.opened);
    } catch {
      if (active.current) setFailed(true);
    } finally {
      pending.current = false;
      if (active.current) setOpening(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border bg-surface-modal p-6 shadow-lg"
        data-testid="microphone-permission-dialog"
      >
        <DialogTitle className="text-lg font-semibold">{t('composer.microphonePermission.title')}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t(`composer.microphonePermission.${access.status === 'restricted' ? 'restricted' : 'denied'}`)}
        </DialogDescription>
        {failed && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-400">{t('composer.microphonePermission.openFailed')}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={close}>{t('composer.microphonePermission.close')}</Button>
          {access.canOpenSettings && <Button disabled={opening} onClick={() => void openSettings()}>{t('composer.microphonePermission.openSettings')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

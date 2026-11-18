import { useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfigDialogContent } from '@/components/ui/config-dialog-content';
import { Dialog } from '@/components/ui/dialog';

/** Common bounded configuration surface for chat, voice and image services. */
export function ModelConfigDialog({ open, onClose, title, description, children, footer, layout, busy = false, testId, returnFocusRef }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  layout?: 'standard' | 'split';
  busy?: boolean;
  testId: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation('settings');
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
      <ConfigDialogContent
        data-testid={testId}
        title={title}
        description={description}
        closeLabel={t('aiProviders.dialog.close')}
        closeDisabled={busy}
        closeTestId={testId === 'add-provider-dialog' ? 'add-provider-close-button' : `${testId}-close`}
        onClose={onClose}
        footer={footer}
        layout={layout}
        onOpenAutoFocus={() => { openerRef.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={event => {
          const target = returnFocusRef?.current ?? openerRef.current;
          if (target?.isConnected) { event.preventDefault(); target.focus(); }
        }}
      >
        {children}
      </ConfigDialogContent>
    </Dialog>
  );
}

export const modelFieldClasses = 'h-9 rounded-lg bg-surface-modal font-sans text-sm shadow-none';
export const modelFieldLabelClasses = 'text-sm text-foreground/80 font-medium';

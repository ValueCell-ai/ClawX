import { useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/** Common bounded configuration surface for chat, voice and image services. */
export function ModelConfigDialog({ open, onClose, title, description, children, footer, busy = false, testId, returnFocusRef }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  testId: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation('settings');
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
      <DialogContent
        data-testid={testId}
        className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0"
        onOpenAutoFocus={() => { openerRef.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={event => {
          const target = returnFocusRef?.current ?? openerRef.current;
          if (target?.isConnected) { event.preventDefault(); target.focus(); }
        }}
      >
        <div className="shrink-0 px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="font-sans text-xl font-medium tracking-normal">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</DialogDescription>
        </div>
        <Button data-testid={testId === 'add-provider-dialog' ? 'add-provider-close-button' : `${testId}-close`} type="button" variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8" disabled={busy} aria-label={t('aiProviders.dialog.close')} onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </DialogContent>
    </Dialog>
  );
}

export const modelFieldClasses = 'h-9 rounded-lg bg-surface-modal font-sans text-sm shadow-none';

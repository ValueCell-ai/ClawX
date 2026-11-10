import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type ConfigDialogContentProps = Omit<ComponentPropsWithoutRef<typeof DialogContent>, 'title' | 'asChild' | 'className'> & {
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
  closeDisabled?: boolean;
  closeTestId?: string;
  footer?: ReactNode;
};

export function ConfigDialogContent({
  title, description, closeLabel, onClose, closeDisabled, closeTestId, footer, children, ...props
}: ConfigDialogContentProps) {
  return (
    <DialogContent
      {...props}
      className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0"
    >
      <div className="shrink-0 px-5 pb-4 pt-5 pr-12">
        <DialogTitle className="font-sans text-xl font-medium tracking-normal">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</DialogDescription>
      </div>
      <Button data-testid={closeTestId} type="button" variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8"
        disabled={closeDisabled} aria-label={closeLabel} onClick={onClose}>
        <X className="h-4 w-4" />
      </Button>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
    </DialogContent>
  );
}

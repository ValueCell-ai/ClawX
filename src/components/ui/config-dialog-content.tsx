import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ConfigDialogContentProps = Omit<ComponentPropsWithoutRef<typeof DialogContent>, 'title' | 'asChild' | 'className'> & {
  title: string;
  description?: string;
  closeLabel: string;
  onClose: () => void;
  closeDisabled?: boolean;
  closeTestId?: string;
  layout?: 'standard' | 'split';
  footer?: ReactNode;
};

export function ConfigDialogContent({
  title, description, closeLabel, onClose, closeDisabled, closeTestId, layout = 'standard', footer, children, ...props
}: ConfigDialogContentProps) {
  const split = layout === 'split';
  return (
    <DialogContent
      {...(!description && { 'aria-describedby': undefined })}
      {...props}
      className={cn(
        'flex max-h-[85vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0',
        split ? 'h-[min(36rem,85vh)] max-w-3xl' : 'max-w-xl',
      )}
    >
      <div className={cn('shrink-0 px-5 pb-4 pt-5 pr-12', split && 'border-b border-border')}>
        <div className="min-w-0">
          <DialogTitle className="font-sans text-xl font-medium tracking-normal">{title}</DialogTitle>
          {description && <DialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</DialogDescription>}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1', split ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-5 pb-5')}>{children}</div>
      {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button data-testid={closeTestId} type="button" variant="ghost" size="icon" className="absolute right-3 top-3 h-8 w-8"
            disabled={closeDisabled} aria-label={closeLabel} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{closeLabel}</TooltipContent>
      </Tooltip>
    </DialogContent>
  );
}

/**
 * ConfirmDialog - In-DOM confirmation dialog (replaces window.confirm)
 * Keeps focus within the renderer to avoid Windows focus loss after native dialogs.
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

interface ConfirmDialogCopy {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: NonNullable<ConfirmDialogProps['variant']>;
}

function isSameCopy(left: ConfirmDialogCopy, right: ConfirmDialogCopy): boolean {
  return left.title === right.title
    && left.message === right.message
    && left.confirmLabel === right.confirmLabel
    && left.cancelLabel === right.cancelLabel
    && left.variant === right.variant;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  onError,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const currentCopy: ConfirmDialogCopy = {
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant,
  };
  const [lastOpenCopy, setLastOpenCopy] = useState<ConfirmDialogCopy>(currentCopy);
  const renderedCopy = open ? currentCopy : lastOpenCopy;

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setConfirming(false);
    }
  }

  if (open && !isSameCopy(lastOpenCopy, currentCopy)) {
    setLastOpenCopy(currentCopy);
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !confirming) {
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (confirming) return;
    const result = onConfirm();
    if (result instanceof Promise) {
      setConfirming(true);
      result.catch((error) => {
        if (onError) {
          onError(error);
        }
      }).finally(() => {
        setConfirming(false);
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border bg-surface-modal p-6 shadow-lg"
        onEscapeKeyDown={(event) => {
          if (confirming) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (confirming) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogTitle className="text-lg font-semibold">
          {renderedCopy.title}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {renderedCopy.message}
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            data-testid="confirm-dialog-cancel-button"
            ref={cancelRef}
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
          >
            {renderedCopy.cancelLabel}
          </Button>
          <Button
            data-testid="confirm-dialog-confirm-button"
            variant={renderedCopy.variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={confirming}
          >
            {renderedCopy.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

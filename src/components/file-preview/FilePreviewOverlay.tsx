/** Right drawer container for the same reader used by Workspace and Preview. */
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { FilePreviewSurface } from './FilePreviewSurface';
import type { FilePreviewTarget } from './types';

export type { FilePreviewTarget } from './types';

interface FilePreviewOverlayProps {
  file: FilePreviewTarget | null;
  open: boolean;
  onClose: () => void;
  onReturnFocus: () => void;
  initialPptxSlideIndex?: number;
  onPptxSlideIndexChange?: (index: number) => void;
}

export function FilePreviewOverlay({ file, open, onClose, onReturnFocus, initialPptxSlideIndex, onPptxSlideIndexChange }: FilePreviewOverlayProps) {
  const { t } = useTranslation('chat');
  if (!file) return null;
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose(); }}>
      <SheetContent side="right" data-testid="skill-file-reader"
        className="inset-y-2 right-2 flex h-[calc(100%-16px)] w-[calc(100vw-16px)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border border-border bg-surface-modal p-0 data-[state=closed]:pointer-events-none sm:w-[min(80vw,1100px)] sm:max-w-[1100px]"
        aria-describedby={undefined}
        onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
        <SheetTitle className="sr-only">{file.fileName}</SheetTitle>
        <FilePreviewSurface file={file} active={open}
          initialPptxSlideIndex={initialPptxSlideIndex}
          onPptxSlideIndexChange={onPptxSlideIndexChange}
          trailingHeader={<SheetClose asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('filePreview.actions.close')} title={t('filePreview.actions.close')}><X className="h-4 w-4" /></Button></SheetClose>}
        />
      </SheetContent>
    </Sheet>
  );
}

export default FilePreviewOverlay;

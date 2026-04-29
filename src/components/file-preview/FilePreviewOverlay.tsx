/**
 * Sheet-based wrapper around `FilePreviewBody`, used by the Skills page
 * (read-only) to preview SKILL.md and friends in a full-screen overlay.
 *
 * The Chat page uses the inline `ArtifactPanel` instead of this component.
 */
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { FilePreviewBody } from './FilePreviewBody';
import type { FilePreviewTarget } from './types';

export type { FilePreviewTarget } from './types';

export interface FilePreviewOverlayProps {
  file: FilePreviewTarget | null;
  readOnly?: boolean;
  onClose: () => void;
}

export function FilePreviewOverlay({ file, readOnly = false, onClose }: FilePreviewOverlayProps) {
  return (
    <Sheet open={!!file} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[70vw] max-w-[1100px] sm:max-w-[1100px] p-0 flex flex-col"
      >
        {file && <FilePreviewBody file={file} readOnly={readOnly} />}
      </SheetContent>
    </Sheet>
  );
}

export default FilePreviewOverlay;

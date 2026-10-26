import { ArrowLeft, Copy, ExternalLink, FolderOpen, MoreHorizontal, FileSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { hostApi } from '@/lib/host-api';
import { isHtmlPreviewExt } from '@/lib/generated-files';
import { htmlPreviewFileUrl } from '@/lib/local-html-browser';
import { FilePreviewBody } from './FilePreviewBody';
import { previewDisplayPath } from './build-preview-target';
import { getFilePreviewTargetIdentity, type FilePreviewTarget } from './types';

export function FilePreviewSurface({ file, active, onBrowse, backToFiles, revision = 0 }: {
  file: FilePreviewTarget | null;
  active: boolean;
  onBrowse?: () => void;
  backToFiles?: boolean;
  revision?: number;
}) {
  const { t } = useTranslation('chat');
  if (!file) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" data-testid="workspace-preview-empty">
      <span className="rounded-2xl bg-primary/5 p-3 text-primary/70"><FileSearch className="h-6 w-6" /></span>
      <p className="text-sm font-medium">{t('artifactPanel.preview.emptyTitle')}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{t('artifactPanel.preview.emptyHint')}</p>
    </div>
  );
  const identity = getFilePreviewTargetIdentity(file);
  const path = previewDisplayPath(file);
  const external = isHtmlPreviewExt(file.ext) ? htmlPreviewFileUrl(file) : null;
  const reveal = async () => {
    try {
      if (file.workspaceFileRef) {
        const result = await hostApi.files.revealWorkspaceFile(file.workspaceFileRef);
        if (!result.ok) throw new Error(result.error);
      } else if (file.attachmentFileRef) {
        const result = await hostApi.files.revealAttachment(file.attachmentFileRef);
        if (!result.ok) throw new Error(result.error);
      } else await hostApi.shell.showItemInFolder(file.filePath);
    } catch { toast.error(t('filePreview.errors.openInFinderFailed')); }
  };
  return (
    <FilePreviewBody
      key={`${identity}:${revision}`}
      file={file}
      compact
      singleLineHeader
      mode="preview"
      active={active}
      initialPptxSlideIndex={useArtifactPanel.getState().previewSlidePositions[identity] ?? 0}
      onPptxSlideIndexChange={index => useArtifactPanel.getState().rememberPreviewSlide(identity, index)}
      leadingHeader={backToFiles && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onBrowse} title={t('workspace.browseFiles')} aria-label={t('workspace.browseFiles')} data-testid="workspace-back-to-files"><ArrowLeft className="h-4 w-4" /></Button>}
      trailingHeader={<>
        {external && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('filePreview.actions.openHtmlExternally')} title={t('filePreview.actions.openHtmlExternally')} data-testid="html-preview-open-external" onClick={() => {
          hostApi.webBrowser.openExternal(external).catch(() => toast.error(t('filePreview.errors.openHtmlExternallyFailed')));
        }}><ExternalLink className="h-4 w-4" /></Button>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={t('workspace.fileActions')} title={t('workspace.fileActions')} data-testid="file-preview-actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="clawx-menu-list min-w-40 rounded-xl border border-border bg-surface-modal p-1.5 shadow-xl">
            <DropdownMenu.Item className="clawx-menu-item flex items-center gap-2 text-xs" onSelect={() => {
              void navigator.clipboard.writeText(path).then(() => toast.success(t('workspace.pathCopied')), () => toast.error(t('workspace.copyFailed')));
            }}><Copy className="h-3.5 w-3.5" />{t('workspace.copyPath')}</DropdownMenu.Item>
            <DropdownMenu.Item className="clawx-menu-item flex items-center gap-2 text-xs" onSelect={() => void reveal()}><FolderOpen className="h-3.5 w-3.5" />{t('filePreview.actions.openInFinder')}</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
      </>}
    />
  );
}

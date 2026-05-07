/**
 * Inline panel showing files the AI wrote/edited in the current run.
 * Lives directly under the ExecutionGraphCard for each user trigger
 * (see Chat/index.tsx).
 */
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { invokeIpc } from '@/lib/api-client';
import {
  computeLineStats,
  supportsInlineDiff,
  supportsRichDocumentPreview,
  type GeneratedFile,
} from '@/lib/generated-files';

export interface GeneratedFilesPanelProps {
  files: GeneratedFile[];
  onOpen: (file: GeneratedFile) => void;
  onRevealInFileManager?: (file: GeneratedFile) => void;
  className?: string;
}

export function GeneratedFilesPanel({
  files,
  onOpen,
  onRevealInFileManager,
  className,
}: GeneratedFilesPanelProps) {
  const { t } = useTranslation('chat');

  if (!files.length) return null;

  const revealInFileManager = (file: GeneratedFile) => {
    if (onRevealInFileManager) {
      onRevealInFileManager(file);
      return;
    }
    void invokeIpc('shell:showItemInFolder', file.filePath);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="px-1">
        <p className="text-xs font-semibold text-foreground/75">
          {t('generatedFiles.title', { count: files.length, defaultValue: 'File changes ({{count}})' })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((file) => {
          const lineStats = computeLineStats(file);
          const clickable = supportsInlineDiff(file);
          const revealOnly = supportsRichDocumentPreview(file.ext);
          if (revealOnly) {
            return (
              <button
                key={`${file.filePath}-${file.lastSeenIndex}`}
                type="button"
                onClick={() => revealInFileManager(file)}
                className={cn(
                  'group inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-black/8 bg-black/[0.035] px-3.5 py-2 text-left transition-colors',
                  'hover:border-black/12 hover:bg-black/[0.055] dark:hover:bg-white/[0.07]',
                  'dark:border-white/10 dark:bg-white/[0.04]',
                )}
                title={file.filePath}
              >
                <div className="min-w-0 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[13px] leading-none">
                  <span className="shrink-0 font-medium text-foreground">{file.fileName}</span>
                  <span className="truncate text-muted-foreground">{file.filePath}</span>
                </div>
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full border border-black/8 bg-black/[0.045] px-1.5 py-0.5 text-2xs text-foreground/70 dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground/75"
                >
                  <FolderOpen className="mr-1 h-3 w-3" />
                  {t('generatedFiles.openFolder', 'Open folder')}
                </Badge>
              </button>
            );
          }
          return (
            <button
              key={`${file.filePath}-${file.lastSeenIndex}`}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (clickable) onOpen(file);
              }}
              className={cn(
                'group inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-black/8 bg-black/[0.035] px-3.5 py-2 text-left transition-colors disabled:opacity-100',
                clickable && 'hover:border-black/12 hover:bg-black/[0.055] dark:hover:bg-white/[0.07]',
                !clickable && 'cursor-default',
                'dark:border-white/10 dark:bg-white/[0.04]',
              )}
              title={file.filePath}
            >
              <div className="min-w-0 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[13px] leading-none">
                <span className="shrink-0 font-medium text-foreground">{file.fileName}</span>
                <span className="truncate text-muted-foreground">{file.filePath}</span>
              </div>
              {lineStats && (
                <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs leading-none tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">+{lineStats.added}</span>
                  <span className="text-rose-600 dark:text-rose-400">-{lineStats.removed}</span>
                </div>
              )}
              <Badge
                variant="secondary"
                className="shrink-0 rounded-full border border-black/8 bg-black/[0.045] px-1.5 py-0.5 text-2xs text-foreground/70 dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground/75"
              >
                {file.action === 'created'
                  ? t('generatedFiles.created', 'Created')
                  : t('generatedFiles.modified', 'Modified')}
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default GeneratedFilesPanel;

/**
 * Inline panel showing files the AI wrote/edited in the current run.
 * Lives directly under the ExecutionGraphCard for each user trigger
 * (see Chat/index.tsx).
 */
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { GeneratedFile } from '@/lib/generated-files';
import { FilePreviewIcon } from './file-card-utils';

export interface GeneratedFilesPanelProps {
  files: GeneratedFile[];
  onOpen: (file: GeneratedFile) => void;
  /**
   * Optional handler for the "查看文件变更 →" link rendered next to the
   * card row.  When provided, ClawX shows the link so users can pop the
   * artifact panel open in list view (vs. drilling into a single file).
   */
  onShowAll?: () => void;
  className?: string;
}

export function GeneratedFilesPanel({ files, onOpen, onShowAll, className }: GeneratedFilesPanelProps) {
  const { t } = useTranslation('chat');

  if (!files.length) return null;

  return (
    <div className={cn('rounded-2xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-white/5', className)}>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-foreground/80">
          {t('generatedFiles.title', { count: files.length, defaultValue: '文件变更（{{count}} 个）' })}
        </p>
        {onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="inline-flex items-center gap-1 text-2xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            {t('generatedFiles.viewAll', '查看文件变更')}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((file) => (
          <button
            key={`${file.filePath}-${file.lastSeenIndex}`}
            type="button"
            onClick={() => onOpen(file)}
            className={cn(
              'group flex max-w-[260px] items-center gap-2 rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-left transition-colors',
              'hover:border-primary/40 hover:bg-primary/5',
              'dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10',
            )}
            title={file.filePath}
          >
            <FilePreviewIcon
              contentType={file.contentType}
              mimeType={file.mimeType}
              ext={file.ext}
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{file.fileName}</p>
              <p className="truncate text-2xs text-muted-foreground">
                {file.filePath}
              </p>
            </div>
            <Badge
              variant={file.action === 'created' ? 'default' : 'secondary'}
              className="shrink-0 text-2xs px-1.5 py-0"
            >
              {file.action === 'created'
                ? t('generatedFiles.created', '新增')
                : t('generatedFiles.modified', '修改')}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

export default GeneratedFilesPanel;

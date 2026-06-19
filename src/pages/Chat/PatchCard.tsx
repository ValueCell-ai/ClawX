import { FileDiff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PatchSummaryEntry } from '@/chat-core/openclaw-port/types';

function uniquePaths(patch: PatchSummaryEntry): string[] {
  return Array.from(new Set([...(patch.filePaths ?? []), ...(patch.files ?? [])].filter(Boolean)));
}

function countValue(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function PatchCard({ patch }: { patch: PatchSummaryEntry }) {
  const { t } = useTranslation('chat');
  const paths = uniquePaths(patch);
  const fileCount = countValue(patch.fileCount) ?? paths.length;
  const added = countValue(patch.added);
  const modified = countValue(patch.modified);
  const deleted = countValue(patch.deleted);
  const summary = patch.summary?.trim() || patch.title?.trim() || t('patchCard.title');

  return (
    <section
      className="w-[50vw] max-w-full rounded-md border border-border bg-surface-input text-sm"
      data-testid="chat-patch-card"
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <FileDiff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <h3 className="break-words text-xs font-medium text-foreground">{summary}</h3>
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
                {t('patchCard.files', { count: fileCount })}
              </span>
              {added != null ? <span className="text-green-700 dark:text-green-400">+{added}</span> : null}
              {modified != null ? <span>{t('patchCard.modified', { count: modified })}</span> : null}
              {deleted != null ? <span className="text-red-700 dark:text-red-400">-{deleted}</span> : null}
            </div>
          </div>
          {paths.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {paths.slice(0, 4).map((path) => (
                <li key={path} className="truncate font-mono" title={path}>{path}</li>
              ))}
              {paths.length > 4 ? (
                <li className="text-2xs">{t('patchCard.moreFiles', { count: paths.length - 4 })}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

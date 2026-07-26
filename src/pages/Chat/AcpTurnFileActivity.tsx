import { FileDiff, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildWorkspacePreviewTarget } from '@/components/file-preview/build-preview-target';
import type { AcpTurnFileSummary } from '@/lib/acp/openclaw-file-activities';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { AcpFileCard } from './AcpFileCard';

export function AcpTurnFileActivity({
  summaries,
  workspaceRoot,
}: {
  summaries: AcpTurnFileSummary[];
  workspaceRoot: string;
}) {
  const { t } = useTranslation('chat');
  const openChanges = useArtifactPanel((state) => state.openChanges);
  const openPreview = useArtifactPanel((state) => state.openPreview);

  if (summaries.length === 0) return null;

  return (
    <div data-testid="acp-turn-file-activity" className="w-full space-y-2 rounded-xl border border-black/10 bg-surface-modal p-2 dark:border-white/10">
      {summaries.map((summary) => {
        const focus = { relativePath: summary.relativePath, turnId: summary.turnId };
        const actionLabel = t(`fileActivity.${summary.action}`);
        return (
          <AcpFileCard
            key={summary.relativePath}
            variant="grouped"
            primaryTestId="acp-file-button"
            primaryAriaLabel={t('fileActivity.fileButton', { action: actionLabel, path: summary.relativePath })}
            onPrimary={() => {
              if (summary.action === 'deleted') {
                openChanges(focus);
              } else {
                openPreview(buildWorkspacePreviewTarget({ workspaceRoot, relativePath: summary.relativePath }));
              }
            }}
            openWith={summary.action === 'deleted'
              ? undefined
              : {
                  target: {
                    kind: 'workspace',
                    ref: { workspaceRoot, relativePath: summary.relativePath },
                  },
                  name: summary.relativePath,
                }}
            trailing={(
              <button
                type="button"
                data-testid="acp-file-summary-row"
                aria-label={t('fileActivity.changeRecord', { path: summary.relativePath })}
                onClick={() => openChanges(focus)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
              >
                <FileDiff className="h-3.5 w-3.5" />
                {summary.added !== null && summary.removed !== null && (
                  <>
                    <span className="text-green-700 dark:text-green-400">+{summary.added}</span>
                    <span className="text-red-700 dark:text-red-400">-{summary.removed}</span>
                  </>
                )}
              </button>
            )}
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-xs text-foreground">{summary.relativePath}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{actionLabel}</span>
          </AcpFileCard>
        );
      })}
    </div>
  );
}

import { Ban, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CompactionItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';

function compactionLabelKey(item: CompactionItem): string {
  if (item.status === 'in_progress') return 'acp.compaction.inProgress';
  if (item.status === 'completed' && item.willRetry) return 'acp.compaction.continuing';
  return `acp.compaction.${item.status}`;
}

function compactionStatusClasses(status: CompactionItem['status']): string {
  if (status === 'completed') return 'text-green-700 dark:text-green-400';
  if (status === 'failed') return 'text-red-700 dark:text-red-400';
  if (status === 'cancelled') return 'text-yellow-700 dark:text-yellow-400';
  return 'text-muted-foreground';
}

function CompactionStatusIcon({ status }: { status: CompactionItem['status'] }) {
  if (status === 'in_progress') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  }
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />;
  return <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function AcpCompactionStatus({ item }: { item: CompactionItem }) {
  const { t } = useTranslation('chat');

  return (
    <div
      data-testid="acp-compaction-status"
      role={item.historical === true ? undefined : 'status'}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg bg-surface-input px-3 py-2 text-xs font-medium',
        compactionStatusClasses(item.status),
      )}
    >
      <CompactionStatusIcon status={item.status} />
      <span>{t(compactionLabelKey(item))}</span>
    </div>
  );
}

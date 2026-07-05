import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlanEntry } from '@agentclientprotocol/sdk';
import type { PlanItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';

function entryRecord(entry: PlanEntry): Record<string, unknown> {
  return entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
}

function entryText(entry: PlanEntry, fallback: string): string {
  const record = entryRecord(entry);
  for (const key of ['content', 'title', 'description', 'text', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function entryStatusKey(entry: PlanEntry): string | null {
  const status = entryRecord(entry).status;
  if (status === 'in_progress') return 'acp.running';
  if (status === 'pending') return 'acp.pending';
  if (status === 'completed') return 'acp.completed';
  if (status === 'failed') return 'acp.failed';
  if (status === 'cancelled') return 'acp.cancelled';
  return null;
}

function entryStatusClasses(key: string): string {
  if (key === 'acp.running') return 'text-blue-700 dark:text-blue-400 bg-black/5 dark:bg-white/10';
  if (key === 'acp.completed') return 'text-green-700 dark:text-green-400 bg-black/5 dark:bg-white/10';
  if (key === 'acp.failed' || key === 'acp.cancelled') return 'text-red-700 dark:text-red-400 bg-black/5 dark:bg-white/10';
  return 'text-amber-700 dark:text-amber-400 bg-black/5 dark:bg-white/10';
}

export function AcpPlanItem({ item }: { item: PlanItem }) {
  const { t } = useTranslation('chat');

  return (
    <div
      data-testid="acp-plan-item"
      className="rounded-2xl border border-black/10 bg-surface-modal px-4 py-3 shadow-sm dark:border-white/10"
    >
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">{t('acp.plan')}</span>
      </div>
      <div className="space-y-2">
        {item.entries.map((entry, index) => {
          const statusKey = entryStatusKey(entry);
          return (
            <div key={index} className="flex min-w-0 items-start gap-2 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/10">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words text-sm text-foreground">{entryText(entry, t('acp.plan'))}</span>
              {statusKey && (
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide', entryStatusClasses(statusKey))}>
                  {t(statusKey)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

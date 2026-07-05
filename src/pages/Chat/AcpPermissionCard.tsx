import { ShieldQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { PermissionItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';

function permissionStatusKey(status: PermissionItem['status']): string {
  if (status === 'selected') return 'acp.completed';
  return `acp.${status}`;
}

function permissionStatusClasses(status: PermissionItem['status']): string {
  if (status === 'selected') return 'text-green-700 dark:text-green-400 bg-black/5 dark:bg-white/10';
  if (status === 'cancelled') return 'text-red-700 dark:text-red-400 bg-black/5 dark:bg-white/10';
  return 'text-amber-700 dark:text-amber-400 bg-black/5 dark:bg-white/10';
}

export function AcpPermissionCard({
  item,
  onSelect,
}: {
  item: PermissionItem;
  onSelect?: (requestId: string, optionId: string) => void;
}) {
  const { t } = useTranslation('chat');
  const disabled = item.status !== 'pending' || !onSelect;

  return (
    <div
      data-testid="acp-permission-card"
      className="rounded-2xl border border-amber-500/20 bg-surface-modal px-4 py-3 shadow-sm"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldQuestion className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.permission')}</span>
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{item.title}</span>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide', permissionStatusClasses(item.status))}>
          {t(permissionStatusKey(item.status))}
        </span>
      </div>

      {item.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.options.map((option) => (
            <Button
              key={option.optionId}
              type="button"
              size="sm"
              variant={option.kind === 'reject' ? 'outline' : 'secondary'}
              disabled={disabled}
              onClick={() => onSelect?.(item.requestId, option.optionId)}
            >
              {option.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

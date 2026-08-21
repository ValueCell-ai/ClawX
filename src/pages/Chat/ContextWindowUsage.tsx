import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SessionContextUsage } from '@/lib/acp/session-usage';
import { formatCompactTokenCount } from '@/lib/format-token-count';

export type ContextWindowUsageProps = {
  usage: SessionContextUsage;
  className?: string;
  variant?: 'card' | 'inline';
};

export function ContextWindowUsage({
  usage,
  className,
  variant = 'card',
}: ContextWindowUsageProps) {
  const { t } = useTranslation('chat');
  const statsLabel = useMemo(
    () => t('composer.contextWindowStats', {
      used: formatCompactTokenCount(usage.used),
      total: formatCompactTokenCount(usage.size),
    }),
    [t, usage.size, usage.used],
  );
  const titleLabel = t('composer.contextWindowTitle');

  if (variant === 'inline') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="chat-context-window-usage"
            className={cn(
              'inline-flex h-8 shrink-0 items-center justify-center px-1.5 text-meta font-medium text-muted-foreground',
              className,
            )}
            aria-label={titleLabel}
          >
            <span className="truncate text-center tabular-nums">{statsLabel}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {titleLabel}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      data-testid="chat-context-window-usage"
      className={cn(
        'rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{titleLabel}</span>
        <span className="font-medium text-foreground tabular-nums">{statsLabel}</span>
      </div>
    </div>
  );
}

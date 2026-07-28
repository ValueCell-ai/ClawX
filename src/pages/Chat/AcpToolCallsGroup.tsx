import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCallItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpToolCallCard } from './AcpToolCallCard';

const TOOL_GROUP_AUTO_COLLAPSE_DELAY_MS = 1_000;

export function AcpToolCallsGroup({
  items,
  collapsedByDefault = false,
}: {
  items: ToolCallItem[];
  collapsedByDefault?: boolean;
}) {
  const { t } = useTranslation('chat');
  const shouldStartCollapsed = collapsedByDefault || items.every((item) => item.historical);
  const [expanded, setExpanded] = useState(!shouldStartCollapsed);
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    if (manualOverride || !collapsedByDefault || items.every((item) => item.historical)) return;

    const timer = window.setTimeout(() => {
      setExpanded(false);
    }, TOOL_GROUP_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [collapsedByDefault, items, manualOverride]);

  const toggleLabel = expanded ? t('acp.collapseToolGroup') : t('acp.expandToolGroup');
  const summary = t('acp.toolGroupSummary', { count: items.length });

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="acp-tool-calls-group"
        data-collapsed="true"
        onClick={() => {
          setManualOverride(true);
          setExpanded(true);
        }}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium">
          {summary}
        </span>
      </button>
    );
  }

  return (
    <div data-testid="acp-tool-calls-group" data-collapsed="false" className="flex w-full flex-col gap-0">
      <button
        type="button"
        data-testid="acp-tool-calls-group-collapse"
        onClick={() => {
          setManualOverride(true);
          setExpanded(false);
        }}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="group flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
      >
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium">
          {summary}
        </span>
      </button>

      <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', 'grid-rows-[1fr]')}>
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 flex flex-col gap-0.5">
            {items.map((item) => (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpToolCallCard item={item} grouped />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

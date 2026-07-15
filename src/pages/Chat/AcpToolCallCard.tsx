import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, Wrench, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpRenderPart } from './AcpMessageSegment';

const TOOL_AUTO_COLLAPSE_DELAY_MS = 1_000;

type ExpansionState = {
  toolCallId: string;
  expanded: boolean;
  manualOverride: boolean;
};

function statusLabelKey(status: ToolCallItem['status']): string {
  return `acp.${status}`;
}

function StatusIcon({ status }: { status: ToolCallItem['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === 'failed') return <XCircle className="h-4 w-4" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4" aria-hidden="true" />;
}

function AcpToolOutputPart({ part }: { part: RenderPart }) {
  if (part.kind === 'markdown') {
    return (
      <pre
        data-testid="acp-tool-output-pre"
        className="max-h-96 overflow-auto whitespace-pre rounded-xl border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
      >
        {part.text}
      </pre>
    );
  }

  return <AcpRenderPart part={part} tone="process" />;
}

export function AcpToolCallCard({ item }: { item: ToolCallItem }) {
  const { t } = useTranslation('chat');
  const hasDetails = Boolean(item.error) || item.outputParts.length > 0;
  const isFinished = item.status === 'completed' || item.status === 'failed';
  const shouldStartExpanded = !hasDetails || !(item.historical && isFinished);
  const [expansionState, setExpansionState] = useState<ExpansionState>(() => ({
    toolCallId: item.toolCallId,
    expanded: shouldStartExpanded,
    manualOverride: false,
  }));
  const currentExpansionState = expansionState.toolCallId === item.toolCallId
    ? expansionState
    : { toolCallId: item.toolCallId, expanded: shouldStartExpanded, manualOverride: false };
  const manualOverride = currentExpansionState.manualOverride;
  const expanded = (() => {
    if (!hasDetails) return true;
    if (manualOverride) return currentExpansionState.expanded;
    if (item.historical && isFinished) return false;
    if (!isFinished) return true;
    return currentExpansionState.expanded;
  })();

  useEffect(() => {
    if (manualOverride) return;
    if (!hasDetails || item.historical || !isFinished) return;

    const timer = window.setTimeout(() => {
      setExpansionState((state) => {
        const currentState = state.toolCallId === item.toolCallId
          ? state
          : { toolCallId: item.toolCallId, expanded: shouldStartExpanded, manualOverride: false };
        if (currentState.manualOverride) return currentState;
        return { ...currentState, expanded: false };
      });
    }, TOOL_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasDetails, item.historical, isFinished, item.toolCallId, manualOverride, shouldStartExpanded]);

  const toggleLabel = expanded ? t('acp.collapseTool') : t('acp.expandTool');

  return (
    <div
      data-testid="acp-tool-call-card"
      data-expanded={expanded ? 'true' : 'false'}
      className="rounded-lg px-1 py-0.5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        {hasDetails ? (
          <button
            type="button"
            data-testid="acp-tool-toggle"
            onClick={() => {
              setExpansionState((state) => {
                const currentState = state.toolCallId === item.toolCallId
                  ? state
                  : { toolCallId: item.toolCallId, expanded: shouldStartExpanded, manualOverride: false };
                return { ...currentState, expanded: !expanded, manualOverride: true };
              });
            }}
            aria-expanded={expanded}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{item.title}</span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{item.title}</span>
          </div>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          <StatusIcon status={item.status} />
          {t(statusLabelKey(item.status))}
        </span>
      </div>

      {hasDetails && (
        <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="min-h-0 overflow-hidden" aria-hidden={!expanded}>
            {item.error && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {item.error}
              </div>
            )}

            {item.outputParts.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {item.outputParts.map((part, index) => (
                  <AcpToolOutputPart key={`${part.kind}:${index}`} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

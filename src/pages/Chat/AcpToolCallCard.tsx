import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpRenderPart } from './AcpMessageSegment';
import { describeToolCall } from './tool-call-presentation';

const TOOL_AUTO_COLLAPSE_DELAY_MS = 1_000;
type ExpansionState = {
  toolCallId: string;
  expanded: boolean;
  manualOverride: boolean;
};

function statusLabelKey(status: ToolCallItem['status']): string {
  return `acp.${status}`;
}

function formatToolInput(input: unknown): string | null {
  if (input === undefined) return null;

  try {
    return JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    return String(input);
  }
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

export function AcpToolCallCard({ item, variant = 'standalone' }: {
  item: ToolCallItem;
  variant?: 'standalone' | 'grouped' | 'process';
}) {
  const { t } = useTranslation('chat');
  const { name, argumentsSuffix, presentation, target } = describeToolCall(item);
  const inProcess = variant === 'process';
  const standalone = variant === 'standalone';
  const ToolIcon = presentation?.icon ?? (inProcess ? Wrench : undefined);
  const title = inProcess
    ? (presentation ? t(presentation.labelKey) : (name || item.title))
    : (presentation ? `${t(presentation.labelKey)}${argumentsSuffix}` : item.title);
  const toolInput = inProcess && item.input === undefined
    ? argumentsSuffix.slice(1).trim() || null
    : formatToolInput(item.input);
  const hasDetails = Boolean(item.error) || item.outputParts.length > 0 || toolInput !== null;
  const isFinished = item.status === 'completed' || item.status === 'failed';
  const shouldStartExpanded = !hasDetails || !((inProcess || item.historical) && isFinished);
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
    if ((inProcess || item.historical) && isFinished) return false;
    if (!isFinished) return true;
    return currentExpansionState.expanded;
  })();

  useEffect(() => {
    if (manualOverride) return;
    if (!hasDetails || inProcess || item.historical || !isFinished) return;

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
  }, [hasDetails, inProcess, item.historical, isFinished, item.toolCallId, manualOverride, shouldStartExpanded]);

  const toggleLabel = expanded ? t('acp.collapseTool') : t('acp.expandTool');
  const identity = (
    <>
      {standalone && <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      {standalone && (
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
      )}
      {ToolIcon && <ToolIcon className="size-4 shrink-0 text-muted-foreground" data-testid={presentation && `acp-tool-icon-${presentation.iconName}`} aria-hidden="true" />}
      <span className={cn('min-w-0 truncate font-medium', inProcess ? 'text-sm' : 'text-xs text-muted-foreground')}>
        {title}
        {inProcess && target && <span className="font-normal text-muted-foreground">{' · '}{target}</span>}
      </span>
    </>
  );

  return (
    <div
      data-testid="acp-tool-call-card"
      data-expanded={expanded ? 'true' : 'false'}
      className={cn('w-full min-w-0 rounded-lg px-0', standalone ? 'py-0.5' : 'py-0')}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        {hasDetails ? (
          <Button
            type="button"
            variant="ghost"
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
            aria-label={inProcess ? undefined : toggleLabel}
            title={toggleLabel}
            className={cn(
              'h-auto min-w-0 flex-1 justify-start gap-2 rounded-lg px-1 text-left leading-5',
              inProcess ? 'py-0.5 text-muted-foreground' : 'py-1',
            )}
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {identity}
          </Button>
        ) : (
          <div className={cn(
            'flex min-w-0 flex-1 items-center gap-2 leading-5',
            !standalone && 'px-1 py-1',
            inProcess && 'py-0.5 text-muted-foreground',
          )}>
            {inProcess && <span className="size-4 shrink-0" aria-hidden="true" />}
            {identity}
          </div>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <StatusIcon status={item.status} />
          {t(statusLabelKey(item.status))}
        </span>
      </div>

      {hasDetails && (
        <div className="clawx-inline-disclosure" data-state={expanded ? 'open' : 'closed'}>
          <div className="min-h-0 overflow-hidden" aria-hidden={!expanded}>
            {item.error && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {item.error}
              </div>
            )}

            {toolInput !== null && (
              <pre
                data-testid="acp-tool-input-pre"
                className="mt-3 max-h-96 overflow-auto whitespace-pre rounded-xl border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
              >
                {toolInput}
              </pre>
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

import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Database,
  Globe,
  ListChecks,
  Loader2,
  MonitorPlay,
  ScanText,
  SquareMousePointer,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpRenderPart } from './AcpMessageSegment';

const TOOL_AUTO_COLLAPSE_DELAY_MS = 1_000;

const TOOL_PRESENTATIONS = {
  update_plan: { icon: ListChecks, iconName: 'list-checks', labelKey: 'acp.toolName.updatePlan' },
  web_fetch: { icon: Globe, iconName: 'globe', labelKey: 'acp.toolName.webFetch' },
  browser: { icon: SquareMousePointer, iconName: 'square-mouse-pointer', labelKey: 'acp.toolName.browser' },
  exec: { icon: MonitorPlay, iconName: 'monitor-play', labelKey: 'acp.toolName.execCommand' },
  read: { icon: ScanText, iconName: 'scan-text', labelKey: 'acp.toolName.read' },
  sessions_spawn: { icon: Bot, iconName: 'bot', labelKey: 'acp.toolName.spawnSubagent' },
  memory_search: { icon: Database, iconName: 'database', labelKey: 'acp.toolName.memorySearch' },
} as const;

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

export function AcpToolCallCard({ item, grouped = false }: { item: ToolCallItem; grouped?: boolean }) {
  const { t } = useTranslation('chat');
  const input = typeof item.input === 'object' && item.input !== null
    ? item.input as Record<string, unknown>
    : undefined;
  const separator = item.title.indexOf(':');
  const toolName = separator === -1 ? item.title : item.title.slice(0, separator).trim();
  const titleArguments = separator === -1 ? '' : item.title.slice(separator + 1).trim();
  const presentation = toolName === 'exec'
    ? ((typeof input?.command === 'string' && input.command.trim()) || /^command:\s*\S/.test(titleArguments)
      ? TOOL_PRESENTATIONS.exec
      : undefined)
    : toolName === 'sessions_spawn'
      ? (input?.runtime === 'subagent' || /(?:^|,\s*)runtime:\s*subagent(?:\s*,|$)/.test(titleArguments)
        ? TOOL_PRESENTATIONS.sessions_spawn
        : undefined)
      : TOOL_PRESENTATIONS[toolName as keyof typeof TOOL_PRESENTATIONS];
  const ToolIcon = presentation?.icon;
  const title = presentation
    ? `${t(presentation.labelKey)}${separator === -1 ? '' : item.title.slice(separator)}`
    : item.title;
  const planInput = toolName === 'update_plan' && Array.isArray(input?.plan)
    ? JSON.stringify({ plan: input.plan }, null, 2)
    : null;
  const hasDetails = Boolean(item.error) || item.outputParts.length > 0 || planInput !== null;
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
      className={cn('w-full min-w-0 rounded-lg px-0', grouped ? 'py-0' : 'py-0.5')}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
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
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left leading-5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10',
              grouped ? 'px-1 py-1' : 'p-1',
            )}
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {!grouped && <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {!grouped && (
              <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
            )}
            {ToolIcon && <ToolIcon className="h-4 w-4 shrink-0 text-muted-foreground" data-testid={`acp-tool-icon-${presentation.iconName}`} aria-hidden="true" />}
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{title}</span>
          </button>
        ) : (
          <div className={cn('flex min-w-0 flex-1 items-center gap-2 leading-5', grouped && 'px-1 py-1')}>
            {!grouped && <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            {!grouped && (
              <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('acp.tool')}</span>
            )}
            {ToolIcon && <ToolIcon className="h-4 w-4 shrink-0 text-muted-foreground" data-testid={`acp-tool-icon-${presentation.iconName}`} aria-hidden="true" />}
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{title}</span>
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

            {planInput && (
              <pre
                data-testid="acp-tool-input-pre"
                className="mt-3 max-h-96 overflow-auto whitespace-pre rounded-xl border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
              >
                {planInput}
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

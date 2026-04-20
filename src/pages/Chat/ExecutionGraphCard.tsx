import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, GitBranch, MessageSquare, Wrench, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TaskStep } from './task-visualization';

interface ExecutionGraphCardProps {
  agentLabel: string;
  steps: TaskStep[];
  active: boolean;
  /** Hide the trailing "Thinking ..." indicator even when active. */
  suppressThinking?: boolean;
  /**
   * When provided, the card becomes fully controlled: the parent owns the
   * expand state (e.g. to persist across remounts) and toggling goes through
   * `onExpandedChange`. When omitted, the card manages its own local state.
   */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

const TOOL_ROW_EXTRA_INDENT_PX = 8;

function AnimatedDots({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-0.5 leading-none text-muted-foreground', className)} aria-hidden="true">
      <span className="inline-block animate-bounce [animation-delay:0ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:150ms]">.</span>
      <span className="inline-block animate-bounce [animation-delay:300ms]">.</span>
    </span>
  );
}

function GraphStatusIcon({ status }: { status: TaskStep['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'error') return <XCircle className="h-4 w-4" />;
  return <CircleDashed className="h-4 w-4" />;
}

function StepDetailCard({ step }: { step: TaskStep }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!step.detail;
  // Narration steps (intermediate pure-text assistant messages folded from
  // the chat stream) are rendered without a label/status pill: the message
  // text IS the primary content.
  const isNarration = step.kind === 'message';
  const isTool = step.kind === 'tool';
  const isThinking = step.kind === 'thinking';
  const showRunningDots = isTool && step.status === 'running';
  const hideStatusText = isTool && step.status === 'completed';
  const detailPreview = step.detail?.replace(/\s+/g, ' ').trim();
  const canExpand = hasDetail;
  const usePlainExpandedDetail = isTool || isThinking;
  const displayLabel = isThinking ? t('executionGraph.thinkingLabel') : step.label;

  return (
    <div
      className={cn(
        'min-w-0 flex-1 text-muted-foreground',
        isTool || isNarration
          ? 'px-0 py-0'
          : 'rounded-xl border border-black/10 bg-white/40 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex w-full gap-2 text-left',
          isTool ? 'items-center' : 'items-start',
          canExpand ? 'cursor-pointer' : 'cursor-default',
        )}
        onClick={() => {
          if (!canExpand) return;
          setExpanded((value) => !value);
        }}
      >
        <div className="min-w-0 flex-1">
          {!isNarration && (
            <div className="flex min-w-0 items-center gap-2">
              <p className="shrink-0 text-sm font-medium text-muted-foreground">{displayLabel}</p>
              {isTool && detailPreview && !expanded && (
                <p className="min-w-0 truncate text-[12px] leading-4 text-muted-foreground/80">
                  {detailPreview}
                </p>
              )}
              {!hideStatusText && !showRunningDots && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                  {t(`taskPanel.stepStatus.${step.status}`)}
                </span>
              )}
              {showRunningDots && (
                <AnimatedDots className="text-[14px]" />
              )}
              {step.depth > 1 && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                  {t('executionGraph.branchLabel')}
                </span>
              )}
            </div>
          )}
          {step.detail && !expanded && !isTool && (
            <p
              className={cn(
                'text-muted-foreground',
                isThinking
                  ? 'mt-0.5 text-[12px] leading-5 line-clamp-1'
                  : isNarration
                  ? 'text-[13px] leading-6 text-muted-foreground line-clamp-2'
                  : 'mt-0.5 text-[12px] leading-5 line-clamp-2',
              )}
            >
              {step.detail}
            </p>
          )}
        </div>
        {canExpand && (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        )}
      </button>
      {step.detail && expanded && canExpand && (
        usePlainExpandedDetail ? (
          <pre
            className={cn(
              'mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground',
              isTool ? 'break-all' : 'break-words',
            )}
          >
            {step.detail}
          </pre>
        ) : (
        <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <pre
            className={cn(
              'whitespace-pre-wrap text-[12px] leading-5',
              isNarration ? 'text-muted-foreground' : 'break-all text-muted-foreground',
            )}
          >
            {step.detail}
          </pre>
        </div>
        )
      )}
    </div>
  );
}

export function ExecutionGraphCard({
  agentLabel,
  steps,
  active,
  suppressThinking = false,
  expanded: controlledExpanded,
  onExpandedChange,
}: ExecutionGraphCardProps) {
  const { t } = useTranslation('chat');

  // Active runs should stay expanded by default so the user can follow the
  // execution live. Once the run completes, the default state returns to
  // collapsed. Explicit user toggles remain controlled by the parent override.
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(active);
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (controlledExpanded == null && uncontrolledExpanded !== active) {
      setUncontrolledExpanded(active);
    }
  }

  const isControlled = controlledExpanded != null;
  const expanded = isControlled ? controlledExpanded : uncontrolledExpanded;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setUncontrolledExpanded(next);
    onExpandedChange?.(next);
  };

  const toolCount = steps.filter((step) => step.kind === 'tool').length;
  const processCount = steps.length - toolCount;
  const shouldShowTrailingThinking = active && !suppressThinking;

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="chat-execution-graph"
        data-collapsed="true"
        onClick={() => setExpanded(true)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-muted-foreground dark:hover:bg-white/5"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
        <span className="truncate">
          {t('executionGraph.collapsedSummary', { toolCount, processCount })}
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="chat-execution-graph"
      data-collapsed="false"
      className="w-full px-0 py-0 text-muted-foreground"
    >
      <button
        type="button"
        data-testid="chat-execution-graph-collapse"
        onClick={() => setExpanded(false)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-muted-foreground dark:hover:bg-white/5"
        aria-label={t('executionGraph.collapseAction')}
        title={t('executionGraph.collapseAction')}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90" />
        <span className="truncate">{t('executionGraph.title')}</span>
      </button>

      <div className="mt-0 px-0 py-0">
        <div className="mt-0.5 flex items-center gap-0.5" style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}>
          <div className="flex w-6 shrink-0 justify-center">
            <div className="flex h-6 w-6 items-center justify-center text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm font-medium text-muted-foreground">
              {t('executionGraph.agentRun', { agent: agentLabel })}
            </span>
          </div>
        </div>

        {steps.map((step) => {
          const alignedIndentOffset = (
            step.kind === 'tool'
            || step.kind === 'message'
            || step.kind === 'thinking'
          ) ? TOOL_ROW_EXTRA_INDENT_PX : 0;
          const rowMarginLeft = (Math.max(step.depth - 1, 0) * 24) + alignedIndentOffset;
          return (
          <div key={step.id} className="mt-0.5">
            <div
              className="pl-3"
              style={{ marginLeft: `${rowMarginLeft}px` }}
            >
              <div className="ml-3 h-1 w-px bg-border" />
            </div>
            <div
              className="flex items-start gap-0.5"
              data-testid="chat-execution-step"
              style={{ marginLeft: `${rowMarginLeft}px` }}
            >
              <div className="flex w-6 shrink-0 justify-center">
                <div className="relative flex items-center justify-center">
                  {step.depth > 1 && (
                    <div className="absolute -left-3 top-1/2 h-px w-3 -translate-y-1/2 bg-border" />
                  )}
                  <div
                    className={cn(
                      'flex h-6 w-6 items-center justify-center text-muted-foreground',
                    )}
                  >
                    {step.kind === 'thinking'
                      ? <AnimatedDots className="text-[14px]" />
                      : step.kind === 'tool'
                        ? <Wrench className="h-3.5 w-3.5" />
                        : step.kind === 'message'
                          ? <MessageSquare className="h-3.5 w-3.5" />
                          : <GraphStatusIcon status={step.status} />}
                  </div>
                </div>
              </div>
              <StepDetailCard step={step} />
            </div>
          </div>
        )})}
        {shouldShowTrailingThinking && (
          <div className="mt-0.5">
            <div className="pl-3" style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}>
              <div className="ml-3 h-1 w-px bg-border" />
            </div>
            <div
              className="flex items-center gap-0.5"
              data-testid="chat-execution-step-thinking-trailing"
              style={{ marginLeft: `${TOOL_ROW_EXTRA_INDENT_PX}px` }}
            >
              <div className="w-6 shrink-0" />
              <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                <span className="font-medium">{t('executionGraph.thinkingLabel')}</span>
                <AnimatedDots className="ml-1 inline-flex text-[14px]" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

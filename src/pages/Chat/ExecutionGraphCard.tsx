import { useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, GitBranch, MessageSquare, Sparkles, Wrench, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TaskStep } from './task-visualization';

interface ExecutionGraphCardProps {
  agentLabel: string;
  steps: TaskStep[];
  active: boolean;
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

  return (
    <div className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/40 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
      <button
        type="button"
        className={cn('flex w-full items-start gap-2 text-left', hasDetail ? 'cursor-pointer' : 'cursor-default')}
        onClick={() => {
          if (!hasDetail) return;
          setExpanded((value) => !value);
        }}
      >
        <div className="min-w-0 flex-1">
          {!isNarration && (
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">{step.label}</p>
              <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground dark:bg-white/10">
                {t(`taskPanel.stepStatus.${step.status}`)}
              </span>
              {step.depth > 1 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  {t('executionGraph.branchLabel')}
                </span>
              )}
            </div>
          )}
          {step.detail && !expanded && (
            <p
              className={cn(
                'text-muted-foreground',
                isNarration
                  ? 'text-[13px] leading-6 text-foreground/80 line-clamp-2'
                  : 'mt-1 text-[12px] leading-5 line-clamp-2',
              )}
            >
              {step.detail}
            </p>
          )}
        </div>
        {hasDetail && (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        )}
      </button>
      {step.detail && expanded && (
        <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <pre
            className={cn(
              'whitespace-pre-wrap text-[12px] leading-5',
              isNarration ? 'text-foreground/80' : 'break-all text-muted-foreground',
            )}
          >
            {step.detail}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ExecutionGraphCard({
  agentLabel,
  steps,
  active,
}: ExecutionGraphCardProps) {
  const { t } = useTranslation('chat');

  // Collapse by default when the run is already completed (e.g. loaded from
  // history). While running, always stay expanded. When a run transitions from
  // active -> completed, auto-collapse it. We derive the reset during render
  // via the "adjust state on prop change" pattern recommended by React so the
  // transition is reflected in the same render and doesn't require an effect.
  const [expanded, setExpanded] = useState(active);
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    setExpanded(active);
  }

  const toolCount = steps.filter((step) => step.kind === 'tool').length;
  const processCount = steps.length - toolCount;

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="chat-execution-graph"
        data-collapsed="true"
        onClick={() => setExpanded(true)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
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
      className="w-full rounded-2xl border border-black/10 bg-[#f5f1e8]/70 px-4 py-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{t('executionGraph.title')}</h3>
        {!active && (
          <button
            type="button"
            data-testid="chat-execution-graph-collapse"
            onClick={() => setExpanded(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            aria-label={t('executionGraph.collapseAction')}
            title={t('executionGraph.collapseAction')}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex gap-3">
          <div className="flex w-8 shrink-0 justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div className="min-w-0 flex-1 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <GitBranch className="h-4 w-4 text-primary" />
              <span>{t('executionGraph.agentRun', { agent: agentLabel })}</span>
            </div>
          </div>
        </div>

        {steps.map((step) => (
          <div key={step.id}>
            <div
              className="pl-4"
              style={{ marginLeft: `${Math.max(step.depth - 1, 0) * 24}px` }}
            >
              <div className="ml-4 h-4 w-px bg-border" />
            </div>
            <div
              className="flex gap-3"
              data-testid="chat-execution-step"
              style={{ marginLeft: `${Math.max(step.depth - 1, 0) * 24}px` }}
            >
              <div className="flex w-8 shrink-0 justify-center">
                <div className="relative flex items-center justify-center">
                  {step.depth > 1 && (
                    <div className="absolute -left-4 top-1/2 h-px w-4 -translate-y-1/2 bg-border" />
                  )}
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full',
                      step.status === 'running' && 'bg-primary/10 text-primary',
                      step.status === 'completed' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      step.status === 'error' && 'bg-destructive/10 text-destructive',
                    )}
                  >
                    {step.kind === 'thinking'
                      ? <Sparkles className="h-4 w-4" />
                      : step.kind === 'tool'
                        ? <Wrench className="h-4 w-4" />
                        : step.kind === 'message'
                          ? <MessageSquare className="h-4 w-4" />
                          : <GraphStatusIcon status={step.status} />}
                  </div>
                </div>
              </div>
              <StepDetailCard step={step} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

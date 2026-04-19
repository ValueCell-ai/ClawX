import { useState } from 'react';
import { ArrowDown, ArrowUp, Bot, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, GitBranch, Sparkles, Wrench, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TaskStep } from './task-visualization';

interface ExecutionGraphCardProps {
  agentLabel: string;
  sessionLabel: string;
  steps: TaskStep[];
  active: boolean;
  onJumpToTrigger?: () => void;
  onJumpToReply?: () => void;
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
          {step.detail && !expanded && (
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground line-clamp-2">{step.detail}</p>
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
          <pre className="whitespace-pre-wrap break-all text-[12px] leading-5 text-muted-foreground">
            {step.detail}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ExecutionGraphCard({
  agentLabel,
  sessionLabel,
  steps,
  active,
  onJumpToTrigger,
  onJumpToReply,
}: ExecutionGraphCardProps) {
  const { t } = useTranslation('chat');

  return (
    <div
      data-testid="chat-execution-graph"
      className="w-full rounded-2xl border border-black/10 bg-[#f5f1e8]/70 px-4 py-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t('executionGraph.eyebrow')}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">{t('executionGraph.title')}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {agentLabel} · {sessionLabel}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium',
            active ? 'bg-primary/10 text-primary' : 'bg-black/5 text-foreground/70 dark:bg-white/10 dark:text-foreground/70',
          )}
        >
          {active ? t('executionGraph.status.active') : t('executionGraph.status.previous')}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <button
          type="button"
          data-testid="chat-execution-jump-trigger"
          onClick={onJumpToTrigger}
          className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUp className="h-3.5 w-3.5" />
          <span>{t('executionGraph.userTriggerHint')}</span>
        </button>

        <div className="pl-4">
          <div className="ml-4 h-4 w-px bg-border" />
        </div>

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

        {steps.map((step, index) => (
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
                    {step.kind === 'thinking' ? <Sparkles className="h-4 w-4" /> : step.kind === 'tool' ? <Wrench className="h-4 w-4" /> : <GraphStatusIcon status={step.status} />}
                  </div>
                </div>
              </div>
              <StepDetailCard step={step} />
            </div>
            {index === steps.length - 1 && (
              <>
                <div className="pl-4">
                  <div className="ml-4 h-4 w-px bg-border" />
                </div>
                <button
                  type="button"
                  data-testid="chat-execution-jump-reply"
                  onClick={onJumpToReply}
                  className="flex items-center gap-2 pl-11 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  <span>{t('executionGraph.agentReplyHint')}</span>
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

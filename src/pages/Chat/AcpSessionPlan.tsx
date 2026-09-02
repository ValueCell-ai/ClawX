import { useState } from 'react';
import { CheckCircle2, Circle, CircleEllipsis, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AcpCurrentPlan, AcpCurrentPlanStep } from '@/lib/acp/current-plan';
import { cn } from '@/lib/utils';

function StepIcon({ status }: { status: AcpCurrentPlanStep['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 shrink-0 translate-y-0.5" aria-hidden="true" />;
  if (status === 'in_progress') return <CircleEllipsis className="h-4 w-4 shrink-0 translate-y-0.5" aria-hidden="true" />;
  return <Circle className="h-4 w-4 shrink-0 translate-y-0.5" aria-hidden="true" />;
}

function getPlanIdentity({ completedCount, totalCount, steps }: AcpCurrentPlan): string {
  return JSON.stringify([completedCount, totalCount, steps.map(({ step, status }) => [step, status])]);
}

export function AcpSessionPlan({
  plan,
  sessionKey,
  isExpanded,
  onExpandedChange,
}: {
  plan: AcpCurrentPlan | null | undefined;
  sessionKey: string;
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const [expansion, setExpansion] = useState(() => ({
    planIdentity: plan ? getPlanIdentity(plan) : null,
    sessionKey,
    expanded: false,
  }));

  if (!plan) return null;

  const planIdentity = getPlanIdentity(plan);
  const expanded = expansion.planIdentity === planIdentity
    && expansion.sessionKey === sessionKey
    && (isExpanded ?? expansion.expanded);
  const complete = plan.completedCount === plan.totalCount;
  const panelId = 'acp-session-plan-panel';

  return (
    <div className="relative min-w-0 text-right">
      <button
        type="button"
        data-testid="acp-session-plan-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={t(expanded ? 'acp.sessionPlan.collapse' : 'acp.sessionPlan.expand')}
        onClick={() => {
          const nextExpanded = !expanded;
          setExpansion({ planIdentity, sessionKey, expanded: nextExpanded });
          onExpandedChange?.(nextExpanded);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          'border-black/10 bg-surface-input text-foreground hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          expanded && !complete && 'bg-black/5 dark:bg-white/10',
          complete && 'border-green-500/20 bg-green-500/10 text-green-700 hover:bg-green-500/15 dark:text-green-400',
        )}
      >
        <ListChecks className="h-4 w-4" aria-hidden="true" />
        <span className="tabular-nums">
          {t('acp.sessionPlan.progress', { completed: plan.completedCount, total: plan.totalCount })}
        </span>
      </button>

      {expanded && (
        <section
          id={panelId}
          data-testid="acp-session-plan-panel"
          aria-label={t('acp.sessionPlan.tasks')}
          className="absolute bottom-full right-0 z-10 mb-2 max-h-48 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-black/10 bg-surface-modal p-2 text-left shadow-sm dark:border-white/10"
        >
          <ol className="space-y-1">
            {plan.steps.map((step, index) => {
              return (
                <li
                  key={`${index}:${step.step}`}
                  data-testid="acp-session-plan-step"
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm',
                    step.status === 'completed' && 'text-green-700 dark:text-green-400',
                    step.status !== 'completed' && 'text-muted-foreground',
                  )}
                >
                  <StepIcon status={step.status} />
                  <span className="min-w-0 flex-1 break-words text-foreground">{step.step}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

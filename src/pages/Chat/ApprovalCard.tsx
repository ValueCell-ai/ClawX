import { Check, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ApprovalDecision, ApprovalRequest } from '@/chat-core/openclaw-port/types';

export function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: ApprovalRequest;
  onResolve?: (id: string, decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation('chat');
  const canResolve = approval.status === 'pending' && onResolve;
  const allowedDecisions = approval.allowedDecisions ?? ['allow-once', 'allow-always', 'deny'];
  const title = approval.title || t('approval.title');
  const resolve = (decision: ApprovalDecision) => {
    onResolve?.(approval.id, decision);
  };

  return (
    <article
      className="rounded-md border border-border bg-surface-input px-3 py-3"
      data-testid="chat-approval-card"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{title}</div>
            <span className="rounded-md bg-black/5 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">
              {t(`approval.status.${approval.status}`)}
            </span>
          </div>
          <div className="mt-2 whitespace-pre-wrap break-words rounded-md bg-background px-2 py-1.5 font-mono text-xs text-foreground">
            {approval.detail}
          </div>
          {approval.message ? (
            <div className="mt-2 text-xs text-muted-foreground">{approval.message}</div>
          ) : null}
          {canResolve ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {allowedDecisions.includes('allow-once') ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-input px-2.5 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => resolve('allow-once')}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t('approval.allowOnce')}
                </button>
              ) : null}
              {allowedDecisions.includes('allow-always') ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-input px-2.5 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => resolve('allow-always')}
                >
                  <Check className="h-3.5 w-3.5" />
                  {t('approval.allowAlways')}
                </button>
              ) : null}
              {allowedDecisions.includes('deny') ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-input px-2.5 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => resolve('deny')}
                >
                  <X className="h-3.5 w-3.5" />
                  {t('approval.deny')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

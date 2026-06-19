import { CircleAlert, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RuntimeIndicatorStatus } from '@/chat-core/openclaw-port/types';

export function RuntimeIndicator({ status }: { status: RuntimeIndicatorStatus }) {
  const { t } = useTranslation('chat');
  const label = t(`runtime.${status.kind}.${status.phase}`);
  const isError = status.phase === 'error';
  const Icon = isError ? CircleAlert : RotateCw;

  return (
    <div
      className="rounded-md border border-border bg-surface-input px-3 py-2 text-xs text-muted-foreground"
      data-testid="chat-runtime-indicator"
    >
      <div className="flex items-start gap-2">
        <Icon className={isError ? 'mt-0.5 h-3.5 w-3.5 text-red-700 dark:text-red-400' : 'mt-0.5 h-3.5 w-3.5'} />
        <div className="min-w-0">
          <div className="font-medium text-foreground">{label}</div>
          {status.message ? <div className="mt-1 break-words">{status.message}</div> : null}
        </div>
      </div>
    </div>
  );
}

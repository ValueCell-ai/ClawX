import { useTranslation } from 'react-i18next';
import type { ChatRunUiStatus } from '@/chat-core/openclaw-port/types';

export function RunStatusBar({ status }: { status: ChatRunUiStatus }) {
  const { t } = useTranslation('chat');
  const label = t(`runStatus.${status.phase}`);
  return (
    <div
      className="rounded-md bg-surface-input px-3 py-2 text-xs text-muted-foreground"
      data-testid="chat-run-status"
    >
      {label}
      {status.message ? `: ${status.message}` : ''}
    </div>
  );
}

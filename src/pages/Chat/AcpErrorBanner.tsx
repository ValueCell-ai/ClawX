import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function AcpErrorBanner({
  message,
  kind = 'load',
  onDismiss,
}: {
  message: string;
  kind?: 'load' | 'prompt';
  onDismiss?: () => void;
}) {
  const { t } = useTranslation('chat');
  const title = kind === 'prompt' ? t('acp.promptFailed') : t('acp.loadFailed');

  return (
    <div
      data-testid="acp-error-banner"
      className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-surface-modal px-4 py-3 text-red-700 shadow-sm dark:text-red-400"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 break-words text-sm opacity-80">{message}</p>
      </div>
      {onDismiss && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-red-700 hover:bg-black/5 dark:text-red-400 dark:hover:bg-white/10"
          aria-label={t('acp.dismiss')}
          title={t('acp.dismiss')}
          onClick={onDismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

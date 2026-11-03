import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function ModelConfigurationSummary({ title, description, service, model, configured, loading, onConfigure, triggerRef, prefix }: {
  title: string;
  description: string;
  service?: string;
  model?: string;
  configured: boolean;
  loading: boolean;
  onConfigure: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  prefix: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <p data-testid={`${prefix}-settings-description`} className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div data-testid={`${prefix}-summary`} role="group" aria-label={title} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-modal px-4 py-3" aria-live="polite">
        <div className="min-w-0">
          <p className="text-sm font-medium">{loading ? t('modelManagement.loading') : model || t('modelManagement.notConfigured')}</p>
          {service && <p className="mt-1 break-words text-xs text-muted-foreground">{service}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {!loading && <span className={configured ? 'text-xs text-green-700 dark:text-green-400' : 'text-xs text-muted-foreground'}>{t(configured ? 'modelManagement.configured' : 'modelManagement.needsConfiguration')}</span>}
          <Button ref={triggerRef} data-testid={`${prefix}-configure`} variant="outline" className="h-9 shrink-0" disabled={loading} onClick={onConfigure}>{t(configured ? 'modelManagement.editConfiguration' : 'modelManagement.configure')}</Button>
        </div>
      </div>
    </div>
  );
}

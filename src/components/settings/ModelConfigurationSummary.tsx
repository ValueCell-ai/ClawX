import type { ComponentType, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function ModelConfigurationSummary({ title, description, icon: Icon, service, model, configured, loading, onConfigure, triggerRef, prefix }: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 data-testid={`${prefix}-settings-title`} className="flex items-center gap-2 font-sans text-lg font-medium tracking-normal"><Icon className="h-5 w-5 text-muted-foreground" />{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <Button ref={triggerRef} data-testid={`${prefix}-configure`} variant="outline" className="h-9 shrink-0" disabled={loading} onClick={onConfigure}>{t(configured ? 'modelManagement.editConfiguration' : 'modelManagement.configure')}</Button>
      </div>
      <div data-testid={`${prefix}-summary`} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-modal px-4 py-3" aria-live="polite">
        <div className="min-w-0">
          <p className="text-sm font-medium">{loading ? t('modelManagement.loading') : model || t('modelManagement.notConfigured')}</p>
          {service && <p className="mt-1 break-words text-xs text-muted-foreground">{service}</p>}
        </div>
        {!loading && <span className={configured ? 'text-xs text-green-700 dark:text-green-400' : 'text-xs text-muted-foreground'}>{t(configured ? 'modelManagement.configured' : 'modelManagement.needsConfiguration')}</span>}
      </div>
    </div>
  );
}

import type { ReactNode, RefObject } from 'react';
import { Edit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ModelIcon } from '@/components/common/ModelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ModelConfigurationSummary({ title, description, service, model, configured, loading, onConfigure, triggerRef, prefix, actions }: {
  title: string;
  description: string;
  service?: string;
  model?: string;
  configured: boolean;
  loading: boolean;
  onConfigure: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  prefix: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <p data-testid={`${prefix}-settings-description`} className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div data-testid={`${prefix}-summary`} role="group" aria-label={title} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-modal px-4 py-3" aria-live="polite">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {model && !loading && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5"><ModelIcon modelName={model} className="h-5 w-5" testId={`${prefix}-model-icon`} /></span>}
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{loading ? t('modelManagement.loading') : model || t('modelManagement.notConfigured')}</p>
            {service && <p className="mt-1 break-words text-meta text-muted-foreground">{service}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {!loading && !configured && <span className="mr-2 text-meta text-muted-foreground">{t('modelManagement.needsConfiguration')}</span>}
          {loading ? null : configured ? (
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild><Button ref={triggerRef} data-testid={`${prefix}-configure`} type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={t('modelManagement.editConfiguration')} onClick={onConfigure}><Edit aria-hidden="true" className="h-4 w-4" /></Button></TooltipTrigger>
              <TooltipContent>{t('modelManagement.editConfiguration')}</TooltipContent>
            </Tooltip>
          ) : (
            <Button ref={triggerRef} data-testid={`${prefix}-configure`} variant="outline" className="h-9 shrink-0" onClick={onConfigure}>{t('modelManagement.configure')}</Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}

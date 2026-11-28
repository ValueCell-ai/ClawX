import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { Loader2, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { getProviderIconUrl, shouldInvertInDark } from '@/lib/providers';
import { cn } from '@/lib/utils';

export function ModelConfigPanels({
  label,
  options,
  trailingOption,
  navigationTestId,
  listTestId,
  detailTestId,
  detailKey,
  children,
}: {
  label: string;
  options: ReactNode;
  trailingOption?: ReactNode;
  navigationTestId?: string;
  listTestId?: string;
  detailTestId?: string;
  detailKey?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(8rem,30%)_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)]">
      <div role="group" aria-label={label} data-testid={navigationTestId} className="flex min-h-0 min-w-0 flex-col border-r border-border">
        <div data-testid={listTestId} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2 sm:px-3">
          {options}
        </div>
        {trailingOption && <div className="shrink-0 border-t border-border p-2 sm:px-3">{trailingOption}</div>}
      </div>
      <div key={detailKey} data-testid={detailTestId} className="min-w-0 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {children}
      </div>
    </div>
  );
}

export function ModelServiceIcon({ provider, alt = '', fallback, className }: {
  provider: string;
  alt?: string;
  fallback?: ReactNode;
  className?: string;
}) {
  const icon = getProviderIconUrl(provider);
  const size = cn('h-5 w-5 shrink-0', className);
  return icon ? (
    <img src={icon} alt={alt} className={cn(size, 'object-contain', shouldInvertInDark(provider) && 'dark:invert')} />
  ) : (
    <span aria-hidden="true" className={cn(size, 'flex items-center justify-center')}>{fallback ?? <Plug className="h-full w-full" />}</span>
  );
}

export function ModelConfigOption({ selected, icon, children, ...props }: Omit<ComponentPropsWithoutRef<typeof Button>, 'variant' | 'size' | 'className'> & {
  selected: boolean;
  icon: ReactNode;
}) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={selected}
      className={cn(
        'h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-2 py-1.5 text-left focus-visible:ring-inset focus-visible:ring-offset-0',
        selected && 'bg-accent hover:bg-accent dark:hover:bg-accent',
      )}
    >
      {icon}
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </Button>
  );
}

export function ModelConfigHeading({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="min-w-0">
        <h3 className="break-words text-base font-medium">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function ModelConfigActions({ onCancel, cancelDisabled, label, testId, onSubmit, disabled, busy, reserveLabels, footerTestId }: {
  onCancel: () => void | Promise<void>;
  cancelDisabled?: boolean;
  label: string;
  testId: string;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  reserveLabels?: string[];
  footerTestId?: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-testid={footerTestId} className="grid max-w-full grid-cols-2 gap-2">
      <Button type="button" variant="outline" size="sm" className="min-w-0" disabled={cancelDisabled} onClick={onCancel}>
        {t('aiProviders.dialog.cancel')}
      </Button>
      <div className="relative grid h-9 min-w-0">
        {[...new Set(reserveLabels ?? [label])].map(text => (
          <span key={text} aria-hidden="true" className="invisible col-start-1 row-start-1 self-center whitespace-nowrap border border-transparent px-3 text-sm font-medium">
            {text}
          </span>
        ))}
        <Button type="button" size="sm" className="absolute inset-0 min-w-0 gap-2" data-testid={testId} onClick={onSubmit} disabled={disabled} aria-busy={busy || undefined}>
          {busy && <Loader2 className="absolute h-4 w-4 animate-spin" aria-hidden="true" />}
          <span className={cn('truncate', busy && 'invisible')}>{label}</span>
        </Button>
      </div>
    </div>
  );
}

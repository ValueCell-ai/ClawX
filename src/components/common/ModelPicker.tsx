import { forwardRef, useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { MenuSelectionIndicator } from '@/components/ui/menu-selection';
import { menuOptionStateClass } from '@/components/ui/menu-selection-styles';
import type { ConfiguredModelOption } from '@/lib/model-options';
import { cn } from '@/lib/utils';
import { ModelIcon } from './ModelIcon';

interface ModelPickerProps {
  options: ConfiguredModelOption[];
  value: string | null;
  label: string;
  title: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
  labelledBy?: string;
  testIdPrefix: string;
}

/** Shared model UI; callers retain ownership of global or task-specific changes. */
export const ModelPicker = forwardRef<HTMLButtonElement, ModelPickerProps>(function ModelPicker({
  options, value, label, title, onValueChange, disabled, busy = false,
  open, onOpenChange, onCloseAutoFocus, side = 'top', align = 'end',
  className, labelledBy, testIdPrefix,
}, ref) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const groups = useMemo(() => {
    const groups = new Map<string, { name: string; options: ConfiguredModelOption[] }>();
    for (const option of options) {
      const group = groups.get(option.runtimeProviderKey);
      if (group) group.options.push(option);
      else groups.set(option.runtimeProviderKey, { name: option.providerName, options: [option] });
    }
    return [...groups.entries()];
  }, [options]);
  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={next => {
      if (open === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    }} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={ref} aria-labelledby={labelledBy} type="button" data-testid={`${testIdPrefix}-button`}
          disabled={disabled || busy || !options.length} title={title}
          className={cn(
            'inline-flex h-8 min-w-0 max-w-[140px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:max-w-[220px]',
            (isOpen || busy) && 'text-foreground', className,
          )}
        >
          {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ModelIcon modelName={label} testId={`${testIdPrefix}-current-icon`} />}
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown aria-hidden="true" className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={8} onCloseAutoFocus={onCloseAutoFocus}
          className="w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
          data-testid={`${testIdPrefix}-menu`}>
          <div className="px-3 py-1.5 text-tiny font-medium text-muted-foreground/80">{title}</div>
          <DropdownMenu.RadioGroup value={value ?? ''} onValueChange={onValueChange}
            className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-3rem))] space-y-1 overflow-y-auto">
            {groups.map(([key, group]) => <div key={key} role="group" aria-label={group.name} data-testid={`${testIdPrefix}-provider-group-${key}`}>
              <div title={group.name} className="truncate px-3 pb-0.5 pt-1 text-tiny font-medium text-muted-foreground">{group.name}</div>
              <div className="clawx-menu-list">
                {group.options.map(option => <DropdownMenu.RadioItem key={option.modelRef} value={option.modelRef} asChild>
                  <button type="button" data-testid={`${testIdPrefix}-option-${option.label}`} title={option.label}
                    aria-current={option.modelRef === value ? 'true' : undefined}
                    className={cn('clawx-menu-item flex w-full items-center justify-between gap-3 text-left text-sm font-medium transition-colors', menuOptionStateClass(option.modelRef === value))}>
                    <span className="flex min-w-0 items-center gap-2"><ModelIcon modelName={option.modelId} testId={`${testIdPrefix}-option-icon`} /><span className="min-w-0 truncate">{option.modelId}</span></span>
                    <MenuSelectionIndicator selected={option.modelRef === value} />
                  </button>
                </DropdownMenu.RadioItem>)}
              </div>
            </div>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
});

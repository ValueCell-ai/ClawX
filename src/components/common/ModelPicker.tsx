import { forwardRef, useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { MenuSelectionIndicator } from '@/components/ui/menu-selection';
import { menuOptionStateClass } from '@/components/ui/menu-selection-styles';
import type { ConfiguredModelOption } from '@/lib/model-options';
import { cn } from '@/lib/utils';
import { ModelIcon } from './ModelIcon';

type ModelPickerOption = Pick<ConfiguredModelOption, 'modelRef' | 'label' | 'modelId' | 'providerName' | 'runtimeProviderKey'>;

interface ModelPickerProps {
  options: ModelPickerOption[];
  value: string | null;
  label: string;
  title: string;
  valueTitle?: string;
  providerLabel?: string;
  allModelsLabel?: string;
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
  hideIcon?: boolean;
  testIdPrefix: string;
}

/** Shared model menu; callers own selection and persistence. */
export const ModelPicker = forwardRef<HTMLButtonElement, ModelPickerProps>(function ModelPicker({
  options, value, label, title, valueTitle, providerLabel, allModelsLabel, onValueChange, disabled, busy = false,
  open, onOpenChange, onCloseAutoFocus, side = 'top', align = 'end',
  className, labelledBy, hideIcon = false, testIdPrefix,
}, ref) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const selectedOption = providerLabel ? options.find(option => option.modelRef === value) : undefined;
  const selectedDescriptionId = `${testIdPrefix}-selected-value`;
  const groups = useMemo(() => {
    const groups = new Map<string, { name: string; options: ModelPickerOption[] }>();
    for (const option of options) {
      const group = groups.get(option.runtimeProviderKey);
      if (group) group.options.push(option);
      else groups.set(option.runtimeProviderKey, { name: option.providerName, options: [option] });
    }
    return [...groups.entries()];
  }, [options]);

  function renderOption({ modelRef, label: optionLabel, modelId }: {
    modelRef: string;
    label: string;
    modelId?: string;
  }) {
    const selected = modelRef === (value ?? '');
    return (
      <DropdownMenu.RadioItem key={modelRef} value={modelRef} asChild>
        <button type="button" data-testid={`${testIdPrefix}-option-${optionLabel}`} title={optionLabel}
          aria-current={selected ? 'true' : undefined}
          className={cn('clawx-menu-item flex w-full items-center justify-between gap-3 text-left text-sm font-medium transition-colors', menuOptionStateClass(selected))}>
          <span className="flex min-w-0 items-center gap-2">
            {modelId && <ModelIcon modelName={modelId} testId={`${testIdPrefix}-option-icon`} />}
            <span className="min-w-0 truncate">{modelId ?? optionLabel}</span>
          </span>
          <MenuSelectionIndicator selected={selected} />
        </button>
      </DropdownMenu.RadioItem>
    );
  }

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={next => {
      if (open === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    }} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          ref={ref} aria-labelledby={labelledBy} aria-describedby={labelledBy && selectedOption ? selectedDescriptionId : undefined} type="button" data-testid={`${testIdPrefix}-button`}
          disabled={disabled || busy || !options.length} title={selectedOption ? `${selectedOption.providerName} / ${label}` : valueTitle || title}
          className={cn(
            'inline-flex h-8 min-w-0 max-w-[140px] items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:max-w-[220px]',
            (isOpen || busy) && 'text-foreground', className,
          )}
        >
          {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" /> : !hideIcon && <ModelIcon modelName={label} testId={`${testIdPrefix}-current-icon`} />}
          <span id={selectedDescriptionId} className="flex min-w-0 items-center gap-1">
            {selectedOption && <>
              <span className="min-w-0 max-w-[50%] truncate font-normal text-muted-foreground">{selectedOption.providerName}</span>
              <span className="shrink-0 font-normal text-muted-foreground"> / </span>
            </>}
            <span className="min-w-0 truncate">{label}</span>
          </span>
          <ChevronDown aria-hidden="true" className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={8} onCloseAutoFocus={onCloseAutoFocus}
          className="w-72 overflow-hidden rounded-xl border border-border bg-surface-modal p-1.5 shadow-lg"
          data-testid={`${testIdPrefix}-menu`}>
          <div data-testid={`${testIdPrefix}-title`} className="px-3 py-1.5 text-sm font-normal text-muted-foreground">{title}</div>
          <DropdownMenu.RadioGroup value={value ?? ''} onValueChange={onValueChange}
            className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-3rem))] space-y-2 overflow-y-auto">
            {allModelsLabel && <div className="clawx-menu-list">{renderOption({ modelRef: '', label: allModelsLabel })}</div>}
            {groups.map(([key, group]) => <div key={key} role="group" aria-label={group.name} data-testid={`${testIdPrefix}-provider-group-${key}`}>
              <div title={group.name} className="truncate px-3 py-1 text-sm font-normal text-muted-foreground">{group.name}</div>
              <div className="clawx-menu-list">
                {group.options.map(renderOption)}
              </div>
            </div>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
});

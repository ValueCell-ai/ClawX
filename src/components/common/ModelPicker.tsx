import { forwardRef, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { MenuSelectionIndicator } from '@/components/ui/menu-selection';
import { menuOptionStateClass } from '@/components/ui/menu-selection-styles';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  panel?: { detail?: string; footer?: ReactNode };
  testIdPrefix: string;
}

const surfaceClass = 'w-72 overflow-hidden rounded-xl border border-border bg-surface-modal p-1.5 shadow-lg';

/** Shared model options. The panel variant leaves room for interactive controls below the list. */
export const ModelPicker = forwardRef<HTMLButtonElement, ModelPickerProps>(function ModelPicker({
  options, value, label, title, valueTitle, providerLabel, allModelsLabel, onValueChange, disabled, busy = false,
  open, onOpenChange, onCloseAutoFocus, side = 'top', align = 'end',
  className, labelledBy, hideIcon = false, panel, testIdPrefix,
}, ref) {
  const [localOpen, setLocalOpen] = useState(false);
  const [focusedModel, setFocusedModel] = useState<string | null>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const triggerId = useId();
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
  const selectedRef = value ?? '';
  const hasOption = (modelRef: string) => (modelRef === '' && !!allModelsLabel) || options.some(option => option.modelRef === modelRef);
  const tabStop = focusedModel !== null && hasOption(focusedModel)
    ? focusedModel
    : hasOption(selectedRef) ? selectedRef : allModelsLabel ? '' : groups[0]?.[1].options[0]?.modelRef;
  const triggerDisabled = disabled || (!panel && busy) || (!options.length && !panel?.footer);

  function setOpen(next: boolean) {
    if (next && panel) {
      setFocusedModel(null);
      typeahead.current = { text: '', time: 0 };
    }
    if (open === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  }

  function navigateOptions(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'));
    const index = items.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown': next = items[(index + 1) % items.length]; break;
      case 'ArrowUp': next = items[(index + items.length - 1) % items.length]; break;
      case 'Home': next = items[0]; break;
      case 'End': next = items[items.length - 1]; break;
      default: {
        if (event.key.length !== 1 || event.key === ' ') return;
        const letter = event.key.toLocaleLowerCase();
        const previous = event.timeStamp - typeahead.current.time < 700 ? typeahead.current.text : '';
        const text = previous === letter ? letter : previous + letter;
        typeahead.current = { text, time: event.timeStamp };
        const start = text.length === 1 ? index + 1 : index;
        next = [...items.slice(start), ...items.slice(0, start)]
          .find(option => option.textContent?.trim().toLocaleLowerCase().startsWith(text));
        break;
      }
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  function renderOption({ modelRef, label: optionLabel, modelId }: {
    modelRef: string;
    label: string;
    modelId?: string;
  }) {
    const selected = modelRef === selectedRef;
    const option = (
      <button key={modelRef} type="button" data-testid={`${testIdPrefix}-option-${optionLabel}`} title={optionLabel}
        aria-current={selected ? 'true' : undefined}
        role={panel ? 'option' : undefined}
        aria-selected={panel ? selected : undefined}
        aria-disabled={panel && busy ? true : undefined}
        tabIndex={panel ? (modelRef === tabStop ? 0 : -1) : undefined}
        onFocus={panel ? (event) => {
          setFocusedModel(modelRef);
          event.currentTarget.scrollIntoView?.({ block: 'nearest' });
        } : undefined}
        onClick={panel ? () => { if (!busy) onValueChange(modelRef); } : undefined}
        className={cn(
          'clawx-menu-item flex w-full items-center justify-between gap-3 text-left text-sm font-medium transition-colors',
          panel && 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/20',
          menuOptionStateClass(selected),
        )}>
        <span className="flex min-w-0 items-center gap-2">
          {modelId && <ModelIcon modelName={modelId} testId={`${testIdPrefix}-option-icon`} />}
          <span className="min-w-0 truncate">{modelId ?? optionLabel}</span>
        </span>
        <MenuSelectionIndicator selected={selected} />
      </button>
    );
    return panel ? option : (
      <DropdownMenu.RadioItem key={modelRef} value={modelRef} asChild>
        {option}
      </DropdownMenu.RadioItem>
    );
  }

  const trigger = (
    <button
      ref={ref} id={panel ? triggerId : undefined} aria-labelledby={labelledBy}
      aria-describedby={labelledBy && selectedOption ? selectedDescriptionId : undefined} type="button" data-testid={`${testIdPrefix}-button`}
      disabled={triggerDisabled}
      title={selectedOption ? `${selectedOption.providerName} / ${label}` : valueTitle || title}
      onKeyDown={panel ? (event) => {
        if (!isOpen && !triggerDisabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          setOpen(true);
        }
      } : undefined}
      className={cn(
        'inline-flex h-8 min-w-0 max-w-[140px] items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:max-w-[220px]',
        (isOpen || busy) && 'text-foreground', className,
      )}
    >
      {busy ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" /> : !hideIcon && <ModelIcon modelName={label} testId={`${testIdPrefix}-current-icon`} />}
      <span id={selectedDescriptionId} className="flex min-w-0 items-baseline gap-1">
        {selectedOption && <>
          <span className="min-w-0 max-w-[50%] truncate font-normal text-muted-foreground">{selectedOption.providerName}</span>
          <span className="shrink-0 font-normal text-muted-foreground"> / </span>
        </>}
        <span className={cn('min-w-0 truncate', panel && 'text-foreground')}>{label}</span>
        {panel?.detail && (
          <span className="max-w-[50%] shrink-0 truncate font-normal text-muted-foreground">
            <span aria-hidden="true"> · </span>{panel.detail}
          </span>
        )}
      </span>
      <ChevronDown aria-hidden="true" className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
    </button>
  );
  const header = <div data-testid={`${testIdPrefix}-title`} className="shrink-0 px-3 py-1.5 text-sm font-normal text-muted-foreground">{title}</div>;
  const optionGroups = (
    <>
      {allModelsLabel && <div className="clawx-menu-list">{renderOption({ modelRef: '', label: allModelsLabel })}</div>}
      {groups.map(([key, group]) => <div key={key} role="group" aria-label={group.name} data-testid={`${testIdPrefix}-provider-group-${key}`}>
        <div title={group.name} className="truncate px-3 py-1 text-sm font-normal text-muted-foreground">{group.name}</div>
        <div className="clawx-menu-list">{group.options.map(renderOption)}</div>
      </div>)}
    </>
  );

  if (panel) {
    return (
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent side={side} align={align} aria-labelledby={triggerId} onCloseAutoFocus={onCloseAutoFocus}
          className={cn(surfaceClass, 'flex max-h-[var(--radix-popover-content-available-height)] flex-col')}
          data-testid={`${testIdPrefix}-menu`}>
          {options.length > 0 && <>
            {header}
            <div role="listbox" aria-label={title} aria-busy={busy || undefined} onKeyDown={navigateOptions}
              className="max-h-64 min-h-0 space-y-2 overflow-y-auto overscroll-contain">
              {optionGroups}
            </div>
          </>}
          {panel.footer && (
            <div className={cn('shrink-0 px-3 py-1.5', options.length > 0 && 'mt-1 border-t border-border')}>
              {panel.footer}
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={8} onCloseAutoFocus={onCloseAutoFocus}
          className={surfaceClass}
          data-testid={`${testIdPrefix}-menu`}>
          {header}
          <DropdownMenu.RadioGroup value={selectedRef} onValueChange={onValueChange}
            className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-3rem))] space-y-2 overflow-y-auto">
            {optionGroups}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
});

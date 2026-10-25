import * as React from 'react';
import * as Primitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import { MenuSelectionIndicator } from './menu-selection';
import { cn } from '@/lib/utils';

// Radix reserves the empty string for clearing its value. Keep public empty
// choices (for example automatic language / unassigned agent) selectable.
const EMPTY_VALUE = '__clawx_select_empty__';
const encodeValue = (value: string) => value === '' ? EMPTY_VALUE : value;

export interface SelectProps extends Omit<React.ComponentPropsWithoutRef<typeof Primitive.Trigger>, 'children' | 'value' | 'defaultValue' | 'onChange'> {
  children: React.ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  'data-testid'?: string;
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, children, value, defaultValue, onValueChange, disabled, name, required, placeholder, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? '');
    const [open, setOpen] = React.useState(false);
    const [closing, setClosing] = React.useState(false);
    const contentRef = React.useRef<React.ComponentRef<typeof Primitive.Content>>(null);
    const selectedValue = value === undefined ? uncontrolledValue : value;
    const finishClose = React.useCallback(() => {
      setOpen(false);
      setClosing(false);
    }, []);
    const changeOpen = (next: boolean) => {
      if (next) {
        setClosing(false);
        setOpen(true);
      } else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finishClose();
      } else {
        setClosing(true);
      }
    };
    // This installed Radix Select moves closed content into a DocumentFragment
    // immediately. Keep its context open through the shared CSS exit, and finish
    // on animationend rather than duplicating the motion duration in a timer.
    React.useLayoutEffect(() => {
      if (!closing) return;
      const content = contentRef.current;
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (!content || media.matches || ['', 'none'].includes(getComputedStyle(content).animationName)) {
        finishClose();
        return;
      }
      const handleMotionChange = () => {
        if (media.matches) finishClose();
      };
      media.addEventListener('change', handleMotionChange);
      return () => media.removeEventListener('change', handleMotionChange);
    }, [closing, finishClose]);
    return (
      <Primitive.Root
        open={open}
        onOpenChange={changeOpen}
        value={encodeValue(selectedValue)}
        onValueChange={next => {
          const decoded = next === EMPTY_VALUE ? '' : next;
          if (value === undefined) setUncontrolledValue(decoded);
          onValueChange?.(decoded);
        }}
        disabled={disabled}
        name={name}
        required={required}
      >
        <Primitive.Trigger
          ref={ref}
          value={selectedValue}
          aria-expanded={open && !closing}
          className={cn('flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:border-foreground/30 focus-visible:ring-1 focus-visible:ring-foreground/10 disabled:cursor-not-allowed disabled:opacity-50 [&>span:first-child]:min-w-0 [&>span:first-child]:truncate', className)}
          {...props}
        >
          <Primitive.Value placeholder={placeholder} />
          <Primitive.Icon asChild>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Primitive.Icon>
        </Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            ref={contentRef}
            data-state={closing ? 'closed' : 'open'}
            aria-hidden={closing || undefined}
            inert={closing || undefined}
            onAnimationEnd={event => {
              if (closing && event.target === event.currentTarget) finishClose();
            }}
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            data-slot="select-content"
            className="clawx-floating-surface clawx-select-surface z-[80] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-surface-modal p-1.5 text-foreground shadow-xl"
          >
            <Primitive.Viewport className="clawx-menu-list max-h-[min(308px,var(--radix-select-content-available-height))]">
              {children}
            </Primitive.Viewport>
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    );
  },
);
Select.displayName = 'Select';

export const SelectItem = React.forwardRef<React.ComponentRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ children, className, value, ...props }, ref) => (
    <Primitive.Item ref={ref} value={encodeValue(value)} data-value={value}
      className={cn('clawx-menu-item relative flex cursor-default select-none items-center justify-between gap-3 text-sm outline-none data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/5 data-[state=checked]:bg-primary/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-40', className)} {...props}>
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator><MenuSelectionIndicator selected /></Primitive.ItemIndicator>
    </Primitive.Item>
  ),
);
SelectItem.displayName = 'SelectItem';

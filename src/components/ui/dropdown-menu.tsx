import * as React from 'react';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export { Root, Trigger, Portal, Group, Label, Separator, RadioGroup } from '@radix-ui/react-dropdown-menu';

export const Content = React.forwardRef<React.ComponentRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, collisionPadding = 12, onInteractOutside, ...props }, ref) => {
    const contentRef = React.useRef<React.ComponentRef<typeof Primitive.Content>>(null);
    const composedRef = React.useCallback((node: React.ComponentRef<typeof Primitive.Content> | null) => {
      contentRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }, [ref]);

    return (
      <Primitive.Content
        ref={composedRef}
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-content"
        className={cn('clawx-floating-surface clawx-dropdown-surface z-[80] max-w-[calc(100vw-24px)] outline-none', className)}
        onInteractOutside={event => {
          onInteractOutside?.(event);
          // Non-modal Radix menus keep their dismissal layer during exit. The
          // trigger already toggles the root; its pointer event must not also
          // dismiss a menu that was just reopened before the exit completed.
          const triggerId = contentRef.current?.getAttribute('aria-labelledby');
          const trigger = triggerId ? document.getElementById(triggerId) : null;
          if (event.target instanceof Node && trigger?.contains(event.target)) event.preventDefault();
        }}
        {...props}
      />
    );
  },
);
Content.displayName = 'DropdownMenuContent';

export const Item = React.forwardRef<React.ComponentRef<typeof Primitive.Item>, React.ComponentPropsWithoutRef<typeof Primitive.Item>>(
  ({ className, ...props }, ref) => (
    <Primitive.Item ref={ref} className={cn('outline-none data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/5', className)} {...props} />
  ),
);
Item.displayName = 'DropdownMenuItem';

export const RadioItem = React.forwardRef<React.ComponentRef<typeof Primitive.RadioItem>, React.ComponentPropsWithoutRef<typeof Primitive.RadioItem>>(
  ({ className, ...props }, ref) => (
    <Primitive.RadioItem ref={ref} className={cn('outline-none data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/5 data-[state=checked]:bg-primary/10', className)} {...props} />
  ),
);
RadioItem.displayName = 'DropdownMenuRadioItem';

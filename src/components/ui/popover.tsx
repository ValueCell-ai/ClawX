import * as React from 'react';
import * as Primitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export { Root as Popover, Trigger as PopoverTrigger, Anchor as PopoverAnchor } from '@radix-ui/react-popover';
export const PopoverContent = React.forwardRef<React.ComponentRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(
  ({ className, sideOffset = 8, collisionPadding = 12, ...props }, ref) => (
    <Primitive.Portal>
      <Primitive.Content ref={ref} sideOffset={sideOffset} collisionPadding={collisionPadding}
        data-slot="popover-content"
        className={cn('clawx-floating-surface clawx-popover-surface z-[80] max-w-[calc(100vw-24px)] outline-none', className)} {...props} />
    </Primitive.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';

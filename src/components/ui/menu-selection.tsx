import { cn } from '@/lib/utils';

export function MenuSelectionIndicator({ selected, className }: { selected: boolean; className?: string }) {
  if (!selected) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="menu-selection-indicator"
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-primary', className)}
    />
  );
}

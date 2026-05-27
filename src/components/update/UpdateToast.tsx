/**
 * UpdateToast
 *
 * Custom-rendered Sonner toast card for the "update available" /
 * "update downloaded" prompts. Renders inside `toast.custom()` so we
 * fully own the look (no Sonner default chrome) while still inheriting
 * Sonner's stacking, animation, and dismissal behaviour.
 *
 * Uses ClawX semantic tokens (`bg-popover`, `text-foreground`,
 * `border-border`, …) so the card automatically tracks the active
 * theme — no per-mode hardcoding required.
 */
import { Download, Rocket, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type UpdateToastVariant = 'available' | 'downloaded';

export interface UpdateToastProps {
  variant: UpdateToastVariant;
  title: string;
  description: string;
  primaryActionLabel: string;
  dismissLabel: string;
  onPrimaryAction: () => void;
  onDismiss: () => void;
}

export function UpdateToast({
  variant,
  title,
  description,
  primaryActionLabel,
  dismissLabel,
  onPrimaryAction,
  onDismiss,
}: UpdateToastProps) {
  const Icon = variant === 'downloaded' ? Rocket : Download;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto w-[250px] max-w-[calc(100vw-2rem)]',
        'rounded-lg border border-border bg-popover text-popover-foreground',
        'shadow-lg shadow-black/5 dark:shadow-black/40',
      )}
    >
      <div className="relative p-3.5">
        <p className="px-6 text-center text-sm font-semibold leading-5 text-foreground">
          {title}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={cn(
            'absolute right-2.5 top-2.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            'text-muted-foreground transition-colors',
            'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>

        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="h-8 px-3 text-xs"
          >
            {dismissLabel}
          </Button>
          <Button
            size="sm"
            onClick={onPrimaryAction}
            className="h-8 px-3 text-xs"
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {primaryActionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default UpdateToast;

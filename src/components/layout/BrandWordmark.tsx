import wordmark from '@/assets/brand/clawx-wordmark.png';
import { cn } from '@/lib/utils';

/** The approved compact wordmark, tinted with the current theme foreground. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block bg-current', className)}
      data-testid="sidebar-wordmark"
      style={{
        maskImage: `url(${wordmark})`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
      }}
    />
  );
}

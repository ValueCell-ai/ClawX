/**
 * Select Component
 * Styled native select matching shadcn/ui conventions
 *
 * IMPORTANT: keep an OPAQUE background (`bg-background`) on this element.
 * Chromium paints the dropdown popup using the <select>'s computed
 * background-color and text color. If a caller overrides it with
 * `bg-transparent` (e.g. shared input classes), the popup on Windows
 * renders with a white page background while option text stays light in
 * dark mode — white-on-white. When customizing, pass an opaque themed
 * background (e.g. `bg-background` / `bg-surface-input`), never a
 * transparent one.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none bg-[length:16px_16px] bg-[position:right_12px_center] bg-no-repeat',
          'bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22/%3E%3C/svg%3E")]',
          'pr-10',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };

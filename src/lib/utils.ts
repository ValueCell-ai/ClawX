/**
 * Utility Functions
 * Common utility functions for the application
 */
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge instance configured for ClawX's custom design tokens.
 *
 * Why this is necessary:
 *   `tailwind-merge` ships with hardcoded knowledge of Tailwind's standard
 *   font-size scale (xs / sm / base / lg / xl / 2xl / ...). It does NOT
 *   read tailwind.config.js, so any custom font-size key we add — e.g.
 *   `text-meta`, `text-tiny`, `text-subtitle`, `text-2xs`, `text-stat` —
 *   is classified by twMerge as a *text color* instead of a font-size.
 *
 *   When that happens, merging shadcn's button variant
 *     `bg-primary text-primary-foreground`
 *   with a caller-supplied class string like
 *     `text-meta font-medium rounded-full ...`
 *   silently *removes* `text-primary-foreground` (twMerge thinks both are
 *   colors and keeps only the later one). The button then has no explicit
 *   text color and falls back to inheriting `text-foreground`, producing
 *   the wrong "blue background + dark text" rendering reported in
 *   https://github.com/<repo>/issues — see the Agents page "Add Agent"
 *   button for a live example before this fix.
 *
 * Fix: extend twMerge's `font-size` class group with our custom token
 * names so it correctly identifies them as font-sizes and stops eating
 * the text color.
 *
 * IMPORTANT: keep this list in sync with `theme.extend.fontSize` in
 * `tailwind.config.js`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['2xs', 'tiny', 'meta', 'subtitle', 'stat'] },
      ],
    },
  },
});

/**
 * Merge class names with Tailwind CSS classes.
 * Uses the ClawX-aware twMerge above so custom font-size tokens
 * (text-2xs / tiny / meta / subtitle / stat) are not mistaken for colors.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  } else if (diffDay < 7) {
    return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  } else {
    return then.toLocaleDateString();
  }
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Delay for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

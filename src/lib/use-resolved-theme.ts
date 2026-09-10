/**
 * Resolves the settings-store theme preference to a concrete scheme.
 *
 * While the preference is 'system', subscribes to the OS
 * `prefers-color-scheme` media query so scheme changes propagate live;
 * the one-shot evaluation previously used (only when the setting value
 * changed) froze the theme at whatever the OS was at that moment, which
 * made "follow system" appear to do nothing. Explicit 'light'/'dark'
 * selections are returned as-is.
 */
import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings';

export type ResolvedTheme = 'light' | 'dark';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

function readSystemScheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
}

export function useResolvedTheme(): ResolvedTheme {
  const theme = useSettingsStore((state) => state.theme);
  const [systemScheme, setSystemScheme] = useState<ResolvedTheme>(readSystemScheme);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const syncFromMedia = () => setSystemScheme(media.matches ? 'dark' : 'light');
    syncFromMedia();
    media.addEventListener('change', syncFromMedia);
    return () => media.removeEventListener('change', syncFromMedia);
  }, [theme]);

  return theme === 'system' ? systemScheme : theme;
}

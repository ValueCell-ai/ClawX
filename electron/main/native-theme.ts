/**
 * Native Theme Sync
 *
 * Keeps Electron's `nativeTheme.themeSource` aligned with the app theme
 * setting stored by the renderer. On Windows, the `<select>` dropdown
 * popup (and other native widget surfaces: scrollbars, context menus,
 * file dialogs) is painted by Chromium's native theme, NOT by the page's
 * CSS `color-scheme`. Without this sync, the app can render its own UI
 * dark while the select popup stays light — producing white popup
 * backgrounds behind light option text (unreadable). macOS does not have
 * this problem because its native controls follow the window appearance,
 * but syncing `themeSource` keeps every platform consistent (it also
 * drives `prefers-color-scheme` in the renderer).
 */
import { nativeTheme } from 'electron';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';

export type NativeThemeSource = 'light' | 'dark' | 'system';

/**
 * Map an untrusted persisted theme value to a valid `themeSource`.
 * Anything other than 'light'/'dark' (including 'system' and corrupted
 * values) falls back to 'system' so the OS setting rules.
 */
export function resolveNativeThemeSource(theme: unknown): NativeThemeSource {
  if (theme === 'light' || theme === 'dark') {
    return theme;
  }
  return 'system';
}

export async function applyNativeThemeSetting(theme: unknown): Promise<void> {
  const themeSource = resolveNativeThemeSource(theme);
  try {
    nativeTheme.themeSource = themeSource;
    logger.debug(`Native theme source set to: ${themeSource}`);
  } catch (error) {
    logger.warn('Failed to apply native theme source:', error);
  }
}

export async function syncNativeThemeFromStore(): Promise<void> {
  await applyNativeThemeSetting(await getSetting('theme'));
}

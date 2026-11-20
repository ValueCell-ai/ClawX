import type { LanguageCode } from '../language';
import enMenu from './locales/en/menu.json';
import zhMenu from './locales/zh/menu.json';
import jaMenu from './locales/ja/menu.json';
import ruMenu from './locales/ru/menu.json';

export type MenuLabels = typeof enMenu;

/** Native menus depend only on menu translations, not page namespaces. */
export const MENU_LABELS: Record<LanguageCode, MenuLabels> = {
  en: enMenu,
  zh: zhMenu,
  ja: jaMenu,
  ru: ruMenu,
};

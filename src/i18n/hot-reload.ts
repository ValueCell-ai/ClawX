import type { i18n as I18n } from 'i18next';
import type { I18N_NAMESPACES, I18N_RESOURCES } from '@shared/i18n/resources';
import { SUPPORTED_LANGUAGE_CODES } from '@shared/language';
import type { I18nResources } from '@/extensions/types';

/** Replace rather than merge, so deleted translation keys do not linger in development. */
export function replaceTranslationResources(
  instance: I18n,
  resources: typeof I18N_RESOURCES,
  namespaces: typeof I18N_NAMESPACES,
  extensionResources: readonly I18nResources[] = [],
): void {
  for (const language of SUPPORTED_LANGUAGE_CODES) {
    for (const namespace of namespaces) {
      instance.removeResourceBundle(language, namespace);
      instance.addResourceBundle(language, namespace, resources[language][namespace], true, true);
    }
  }
  // Extensions can augment or override built-in namespaces. Reapply them in
  // registration order before notifying subscribers, just like initial loading.
  for (const extension of extensionResources) {
    for (const [language, bundles] of Object.entries(extension)) {
      for (const [namespace, bundle] of Object.entries(bundles)) {
        instance.addResourceBundle(language, namespace, bundle, true, true);
      }
    }
  }
  // react-i18next subscribes to languageChanged by default; re-render without
  // changing language or remounting the application and its local state.
  instance.emit('languageChanged', instance.language);
}

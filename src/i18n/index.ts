import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
    SUPPORTED_LANGUAGE_CODES,
    resolveSupportedLanguage,
    type LanguageCode,
} from '@shared/language';
import { I18N_NAMESPACES, I18N_RESOURCES } from '@shared/i18n/resources';
import { replaceTranslationResources } from './hot-reload';
import { rendererExtensionRegistry } from '@/extensions/registry';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ru', label: 'Русский' },
] as const satisfies ReadonlyArray<{ code: LanguageCode; label: string }>;

i18n
    .use(initReactI18next)
    .init({
        // Extensions merge into the store; keep dev source data pristine for HMR.
        resources: import.meta.hot ? structuredClone(I18N_RESOURCES) : I18N_RESOURCES,
        lng: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
        fallbackLng: 'en',
        supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
        defaultNS: 'common',
        ns: [...I18N_NAMESPACES],
        interpolation: {
            escapeValue: false, // React already escapes
        },
        react: {
            useSuspense: false,
        },
    });

export default i18n;

if (import.meta.hot) {
    import.meta.hot.accept('@shared/i18n/resources', (updated) => {
        if (!updated) return;
        const extensionResources = rendererExtensionRegistry.getAll().flatMap(extension => (
            extension.i18nResources ? [extension.i18nResources] : []
        ));
        replaceTranslationResources(i18n, updated.I18N_RESOURCES, updated.I18N_NAMESPACES, extensionResources);
    });
}

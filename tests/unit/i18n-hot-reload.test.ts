// @vitest-environment node
import path from 'node:path';
import { build } from 'esbuild';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { I18N_NAMESPACES, I18N_RESOURCES, MENU_LABELS as RENDERER_MENU_LABELS } from '@shared/i18n/resources';
import { MENU_LABELS } from '@shared/i18n/menu-labels';
import { SUPPORTED_LANGUAGE_CODES } from '@shared/language';
import { replaceTranslationResources } from '../../src/i18n/hot-reload';
import type { I18nResources } from '../../src/extensions/types';

describe('translation development boundaries', () => {
  it('loads native menu translations without importing unrelated locale namespaces', async () => {
    const result = await build({
      entryPoints: ['electron/main/menu.ts'],
      absWorkingDir: path.resolve(__dirname, '../..'),
      bundle: true,
      packages: 'external',
      platform: 'node',
      write: false,
      metafile: true,
      alias: { '@shared': path.resolve(__dirname, '../../shared') },
      logLevel: 'silent',
    });
    const localeInputs = Object.keys(result.metafile.inputs).filter(file => file.includes('shared/i18n/locales/'));
    expect(localeInputs.sort()).toEqual(SUPPORTED_LANGUAGE_CODES.map(lang => `shared/i18n/locales/${lang}/menu.json`).sort());
    for (const language of SUPPORTED_LANGUAGE_CODES) {
      expect(MENU_LABELS[language]).toEqual(RENDERER_MENU_LABELS[language]);
      expect(MENU_LABELS[language]).toEqual(I18N_RESOURCES[language].menu);
    }
  });

  it('replaces locale bundles, removes stale keys and preserves the current language', async () => {
    const instance = i18next.createInstance();
    await instance.init({ resources: structuredClone(I18N_RESOURCES), lng: 'zh', fallbackLng: 'en', initImmediate: false });
    instance.addResource('zh', 'agents', 'oldOnlyKey', 'stale');
    const resources = structuredClone(I18N_RESOURCES);
    resources.zh.agents.title = 'updated assistant title';
    resources.en.agents.title = 'updated English title';
    const languageChanged = vi.fn();
    instance.on('languageChanged', languageChanged);
    replaceTranslationResources(instance, resources, I18N_NAMESPACES);
    expect(instance.language).toBe('zh');
    expect(instance.t('agents:title')).toBe('updated assistant title');
    expect(instance.t('agents:title', { lng: 'en' })).toBe('updated English title');
    expect(instance.exists('agents:oldOnlyKey', { fallbackLng: false })).toBe(false);
    expect(languageChanged).toHaveBeenCalledTimes(1);
    expect(languageChanged).toHaveBeenCalledWith('zh');
  });

  it('retains extension additions and override order through consecutive updates', async () => {
    const instance = i18next.createInstance();
    await instance.init({ resources: structuredClone(I18N_RESOURCES), lng: 'zh', fallbackLng: 'en', initImmediate: false });
    const extensions: I18nResources[] = [
      { zh: { agents: { title: 'first extension title', extraLabel: 'extension label' }, custom: { title: 'custom namespace' } } },
      { zh: { agents: { title: 'second extension title' } } },
    ];
    // Seed the extension state that was present before the first update.
    for (const extension of extensions) {
      for (const [namespace, bundle] of Object.entries(extension.zh)) instance.addResourceBundle('zh', namespace, bundle, true, true);
    }
    const languageChanged = vi.fn(() => {
      expect(instance.t('agents:title')).toBe('second extension title');
      expect(instance.t('agents:extraLabel')).toBe('extension label');
    });
    instance.on('languageChanged', languageChanged);
    for (const title of ['first page update', 'second page update']) {
      const resources = structuredClone(I18N_RESOURCES);
      resources.zh.agents.title = title;
      replaceTranslationResources(instance, resources, I18N_NAMESPACES, extensions);
      expect(instance.t('custom:title')).toBe('custom namespace');
      expect(instance.language).toBe('zh');
      expect(resources.zh.agents.title).toBe(title);
    }
    expect(languageChanged).toHaveBeenCalledTimes(2);
  });
});

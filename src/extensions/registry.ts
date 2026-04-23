import i18n from '@/i18n';
import type {
  RendererExtension,
  NavItemDef,
  RouteDef,
  SettingsSectionDef,
  SkillDetailMetaProps,
} from './types';
import type { ComponentType } from 'react';

class RendererExtensionRegistry {
  private extensions: RendererExtension[] = [];

  register(extension: RendererExtension): void {
    if (this.extensions.some((e) => e.id === extension.id)) {
      console.warn(`[extensions] Renderer extension "${extension.id}" already registered`);
      return;
    }
    this.extensions.push(extension);
    if (extension.i18nResources) {
      this.loadI18nResources(extension.i18nResources);
    }
  }

  private loadI18nResources(resources: Record<string, Record<string, unknown>>): void {
    for (const [lang, namespaces] of Object.entries(resources)) {
      for (const [ns, bundle] of Object.entries(namespaces)) {
        i18n.addResourceBundle(lang, ns, bundle, true, true);
      }
    }
  }

  getAll(): RendererExtension[] {
    return [...this.extensions];
  }

  getExtraNavItems(): NavItemDef[] {
    return this.extensions.flatMap((ext) => ext.sidebar?.navItems ?? []);
  }

  getHiddenRoutes(): Set<string> {
    const hidden = new Set<string>();
    for (const ext of this.extensions) {
      for (const route of ext.sidebar?.hiddenRoutes ?? []) {
        hidden.add(route);
      }
    }
    return hidden;
  }

  getExtraRoutes(): RouteDef[] {
    return this.extensions.flatMap((ext) => ext.routes?.routes ?? []);
  }

  getExtraSettingsSections(): SettingsSectionDef[] {
    return this.extensions
      .flatMap((ext) => ext.settings?.sections ?? [])
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  getSkillDetailMetaComponents(): ComponentType<SkillDetailMetaProps>[] {
    return this.extensions.flatMap((ext) => ext.skills?.detailMetaComponents ?? []);
  }

  async initializeAll(): Promise<void> {
    for (const ext of this.extensions) {
      try {
        await ext.setup?.();
      } catch (err) {
        console.error(`[extensions] Renderer extension "${ext.id}" setup failed:`, err);
      }
    }
  }

  teardownAll(): void {
    for (const ext of this.extensions) {
      try {
        ext.teardown?.();
      } catch (err) {
        console.warn(`[extensions] Renderer extension "${ext.id}" teardown failed:`, err);
      }
    }
    this.extensions = [];
  }
}

export const rendererExtensionRegistry = new RendererExtensionRegistry();

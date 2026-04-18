import { rendererExtensionRegistry } from './registry';
import type { RendererExtension } from './types';

interface RendererExtensionManifest {
  extensions?: {
    renderer?: string[];
  };
}

const registeredModules = new Map<string, () => RendererExtension>();

export function registerRendererExtensionModule(id: string, factory: () => RendererExtension): void {
  registeredModules.set(id, factory);
}

export function loadRendererExtensions(manifest?: RendererExtensionManifest): void {
  const extensionIds = manifest?.extensions?.renderer;

  if (!extensionIds || extensionIds.length === 0) {
    for (const [, factory] of registeredModules) {
      rendererExtensionRegistry.register(factory());
    }
    return;
  }

  for (const id of extensionIds) {
    const factory = registeredModules.get(id);
    if (factory) {
      rendererExtensionRegistry.register(factory());
    } else {
      console.warn(`[extensions] Renderer extension "${id}" not found in registered modules`);
    }
  }
}

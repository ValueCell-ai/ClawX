import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import { extensionRegistry } from './registry';
import type { Extension } from './types';

interface ExtensionManifest {
  extensions?: {
    main?: string[];
  };
}

const builtinModules = new Map<string, () => Extension>();

export function registerBuiltinExtension(id: string, factory: () => Extension): void {
  builtinModules.set(id, factory);
}

function resolveManifestPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'clawx-extensions.json');
  }
  return join(app.getAppPath(), 'clawx-extensions.json');
}

export async function loadExtensionsFromManifest(): Promise<void> {
  const manifestPath = resolveManifestPath();
  let manifest: ExtensionManifest = {};

  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
      logger.info(`[extensions] Loaded manifest from ${manifestPath}`);
    } catch (err) {
      logger.warn(`[extensions] Failed to parse ${manifestPath}, using defaults:`, err);
    }
  } else {
    logger.debug('[extensions] No clawx-extensions.json found, loading all builtin extensions');
  }

  const mainExtensions = manifest.extensions?.main;

  if (!mainExtensions || mainExtensions.length === 0) {
    for (const [id, factory] of builtinModules) {
      extensionRegistry.register(factory());
      logger.debug(`[extensions] Auto-registered builtin extension "${id}"`);
    }
    return;
  }

  for (const extensionId of mainExtensions) {
    if (builtinModules.has(extensionId)) {
      extensionRegistry.register(builtinModules.get(extensionId)!());
      continue;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(extensionId) as { default?: Extension; extension?: Extension };
      const ext = mod.default ?? mod.extension;
      if (ext && typeof ext.setup === 'function') {
        extensionRegistry.register(ext);
      } else {
        logger.warn(`[extensions] Module "${extensionId}" does not export a valid Extension`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Cannot find module')) {
        logger.debug(`[extensions] "${extensionId}" not loadable at runtime (expected when using ext-bridge)`);
      } else {
        logger.warn(`[extensions] Failed to load extension "${extensionId}": ${message}`);
      }
    }
  }
}

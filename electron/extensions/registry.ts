import { logger } from '../utils/logger';
import type {
  Extension,
  ExtensionContext,
  MarketplaceProviderExtension,
} from './types';
import {
  isHostApiProviderExtension,
  isMarketplaceProviderExtension,
} from './types';

class ExtensionRegistry {
  private extensions = new Map<string, Extension>();
  private ctx: ExtensionContext | null = null;
  private hostApiUnregisters = new Map<string, () => void>();

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.ctx = ctx;
    for (const ext of this.extensions.values()) {
      try {
        await ext.setup(ctx);
        this.registerHostApiContributions(ext, ctx);
        logger.info(`[extensions] Extension "${ext.id}" initialized`);
      } catch (err) {
        logger.error(`[extensions] Extension "${ext.id}" failed to initialize:`, err);
      }
    }
  }

  register(extension: Extension): void {
    if (this.extensions.has(extension.id)) {
      logger.warn(`[extensions] Extension "${extension.id}" is already registered; skipping duplicate`);
      return;
    }
    this.extensions.set(extension.id, extension);
    logger.debug(`[extensions] Registered extension "${extension.id}"`);

    if (this.ctx) {
      void Promise.resolve(extension.setup(this.ctx))
        .then(() => {
          if (this.ctx) {
            this.registerHostApiContributions(extension, this.ctx);
          }
        })
        .catch((err) => {
          logger.error(`[extensions] Late-registered extension "${extension.id}" failed to initialize:`, err);
        });
    }
  }

  get(id: string): Extension | undefined {
    return this.extensions.get(id);
  }

  getAll(): Extension[] {
    return [...this.extensions.values()];
  }

  getMarketplaceProvider(): MarketplaceProviderExtension | undefined {
    return this.getAll().find(isMarketplaceProviderExtension) as MarketplaceProviderExtension | undefined;
  }

  async teardownAll(): Promise<void> {
    for (const ext of this.extensions.values()) {
      try {
        this.hostApiUnregisters.get(ext.id)?.();
        this.hostApiUnregisters.delete(ext.id);
        await ext.teardown?.();
      } catch (err) {
        logger.warn(`[extensions] Extension "${ext.id}" teardown failed:`, err);
      }
    }
    this.extensions.clear();
    this.ctx = null;
  }

  private registerHostApiContributions(ext: Extension, ctx: ExtensionContext): void {
    this.hostApiUnregisters.get(ext.id)?.();
    this.hostApiUnregisters.delete(ext.id);

    if (!isHostApiProviderExtension(ext)) {
      return;
    }

    const contributions = ext.getHostApiContributions(ctx);
    if (contributions.length === 0) {
      return;
    }
    this.hostApiUnregisters.set(ext.id, ctx.hostApi.register(ext.id, contributions));
  }
}

export const extensionRegistry = new ExtensionRegistry();

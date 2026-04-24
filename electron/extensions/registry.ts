import { logger } from '../utils/logger';
import type {
  Extension,
  ExtensionContext,
  HostApiRouteExtension,
  MarketplaceProviderExtension,
  RouteHandler,
} from './types';
import {
  isHostApiRouteExtension,
  isMarketplaceProviderExtension,
} from './types';

class ExtensionRegistry {
  private extensions = new Map<string, Extension>();
  private ctx: ExtensionContext | null = null;

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.ctx = ctx;
    for (const ext of this.extensions.values()) {
      try {
        await ext.setup(ctx);
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
      void Promise.resolve(extension.setup(this.ctx)).catch((err) => {
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

  getRouteHandlers(): RouteHandler[] {
    return this.getAll()
      .filter(isHostApiRouteExtension)
      .map((ext: HostApiRouteExtension) => ext.getRouteHandler());
  }

  getMarketplaceProvider(): MarketplaceProviderExtension | undefined {
    return this.getAll().find(isMarketplaceProviderExtension) as MarketplaceProviderExtension | undefined;
  }

  async teardownAll(): Promise<void> {
    for (const ext of this.extensions.values()) {
      try {
        await ext.teardown?.();
      } catch (err) {
        logger.warn(`[extensions] Extension "${ext.id}" teardown failed:`, err);
      }
    }
    this.extensions.clear();
    this.ctx = null;
  }
}

export const extensionRegistry = new ExtensionRegistry();

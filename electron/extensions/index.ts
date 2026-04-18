export { extensionRegistry } from './registry';
export { registerBuiltinExtension, loadExtensionsFromManifest } from './loader';
export type {
  Extension,
  ExtensionContext,
  HostApiRouteExtension,
  MarketplaceProviderExtension,
  MarketplaceCapability,
  AuthProviderExtension,
  AuthStatus,
  RouteHandler,
} from './types';
export {
  isHostApiRouteExtension,
  isMarketplaceProviderExtension,
  isAuthProviderExtension,
} from './types';

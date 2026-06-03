export { extensionRegistry } from './registry';
export { registerBuiltinExtension, loadExtensionsFromManifest } from './loader';
export type {
  Extension,
  ExtensionContext,
  HostApiProviderExtension,
  MarketplaceProviderExtension,
  MarketplaceCapability,
  AuthProviderExtension,
  AuthStatus,
} from './types';
export {
  isHostApiProviderExtension,
  isMarketplaceProviderExtension,
  isAuthProviderExtension,
} from './types';

import { registerBuiltinExtension } from '../loader';
import { createClawHubMarketplaceExtension } from './clawhub-marketplace';

export function registerAllBuiltinExtensions(): void {
  registerBuiltinExtension('builtin/clawhub-marketplace', createClawHubMarketplaceExtension);
}

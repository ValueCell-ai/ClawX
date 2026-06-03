import type {
  Extension,
  ExtensionContext,
  MarketplaceProviderExtension,
  MarketplaceCapability,
} from '../types';
import type {
  MarketplaceSearchParams,
  MarketplaceInstallParams,
  MarketplaceSkillResult,
} from '../../gateway/clawhub';

class ClawHubMarketplaceExtension implements MarketplaceProviderExtension {
  readonly id = 'builtin/clawhub-marketplace';

  setup(_ctx: ExtensionContext): void {
    // Built-in public ClawHub marketplace is disabled in community builds.
  }

  async getCapability(): Promise<MarketplaceCapability> {
    return {
      mode: 'local-only',
      canSearch: false,
      canInstall: false,
      reason: 'marketplace-disabled',
    };
  }

  async search(_params: MarketplaceSearchParams): Promise<MarketplaceSkillResult[]> {
    throw new Error('Marketplace search is disabled');
  }

  async install(_params: MarketplaceInstallParams): Promise<void> {
    throw new Error('Marketplace install is disabled');
  }
}

export function createClawHubMarketplaceExtension(): Extension {
  return new ClawHubMarketplaceExtension();
}

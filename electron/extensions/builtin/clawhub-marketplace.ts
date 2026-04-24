import type {
  Extension,
  ExtensionContext,
  MarketplaceProviderExtension,
  MarketplaceCapability,
} from '../types';
import type {
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubSkillResult,
} from '../../gateway/clawhub';

class ClawHubMarketplaceExtension implements MarketplaceProviderExtension {
  readonly id = 'builtin/clawhub-marketplace';

  setup(_ctx: ExtensionContext): void {
    // No setup needed -- search/install delegates to the ClawHubService CLI runner
  }

  async getCapability(): Promise<MarketplaceCapability> {
    return {
      mode: 'clawhub',
      canSearch: true,
      canInstall: true,
    };
  }

  async search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]> {
    const { ClawHubService } = await import('../../gateway/clawhub');
    const svc = new ClawHubService();
    return svc.search(params);
  }

  async install(params: ClawHubInstallParams): Promise<void> {
    const { ClawHubService } = await import('../../gateway/clawhub');
    const svc = new ClawHubService();
    return svc.install(params);
  }
}

export function createClawHubMarketplaceExtension(): Extension {
  return new ClawHubMarketplaceExtension();
}

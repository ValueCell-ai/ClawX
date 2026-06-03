import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { HostApiContribution, HostApiContributionRegistrar } from '../main/ipc/host-contract';
import type {
  MarketplaceSearchParams,
  MarketplaceInstallParams,
  MarketplaceSkillResult,
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubSkillResult,
} from '../gateway/clawhub';

export interface ExtensionContext {
  gatewayManager: GatewayManager;
  getMainWindow: () => BrowserWindow | null;
  hostApi: HostApiContributionRegistrar;
}

export interface Extension {
  id: string;
  setup(ctx: ExtensionContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

export interface MarketplaceCapability {
  mode: string;
  canSearch: boolean;
  canInstall: boolean;
  reason?: string;
}

export interface MarketplaceProviderExtension extends Extension {
  getCapability(): Promise<MarketplaceCapability>;
  search(params: MarketplaceSearchParams): Promise<MarketplaceSkillResult[]>;
  install(params: MarketplaceInstallParams): Promise<void>;
}

export interface HostApiProviderExtension extends Extension {
  getHostApiContributions(ctx: ExtensionContext): HostApiContribution[];
}

export type LegacyMarketplaceSearchParams = ClawHubSearchParams;
export type LegacyMarketplaceInstallParams = ClawHubInstallParams;
export type LegacyMarketplaceSkillResult = ClawHubSkillResult;

export interface AuthStatus {
  authenticated: boolean;
  expired: boolean;
  user: { username: string; displayName: string; email: string } | null;
}

export interface AuthProviderExtension extends Extension {
  getAuthStatus(): Promise<AuthStatus>;
  onStartup?(mainWindow: BrowserWindow): Promise<void>;
}

export function isMarketplaceProviderExtension(ext: Extension): ext is MarketplaceProviderExtension {
  return 'getCapability' in ext && 'search' in ext && 'install' in ext;
}

export function isHostApiProviderExtension(ext: Extension): ext is HostApiProviderExtension {
  return 'getHostApiContributions' in ext
    && typeof (ext as HostApiProviderExtension).getHostApiContributions === 'function';
}

export function isAuthProviderExtension(ext: Extension): ext is AuthProviderExtension {
  return 'getAuthStatus' in ext && typeof (ext as AuthProviderExtension).getAuthStatus === 'function';
}

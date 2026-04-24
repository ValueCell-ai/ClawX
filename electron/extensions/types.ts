import type { IncomingMessage, ServerResponse } from 'http';
import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { HostEventBus } from '../api/event-bus';
import type { HostApiContext } from '../api/context';
import type {
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubSkillResult,
} from '../gateway/clawhub';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
) => Promise<boolean>;

export interface ExtensionContext {
  gatewayManager: GatewayManager;
  eventBus: HostEventBus;
  getMainWindow: () => BrowserWindow | null;
}

export interface Extension {
  id: string;
  setup(ctx: ExtensionContext): void | Promise<void>;
  teardown?(): void | Promise<void>;
}

export interface HostApiRouteExtension extends Extension {
  getRouteHandler(): RouteHandler;
}

export interface MarketplaceCapability {
  mode: string;
  canSearch: boolean;
  canInstall: boolean;
  reason?: string;
}

export interface MarketplaceProviderExtension extends Extension {
  getCapability(): Promise<MarketplaceCapability>;
  search(params: ClawHubSearchParams): Promise<ClawHubSkillResult[]>;
  install(params: ClawHubInstallParams): Promise<void>;
}

export interface AuthStatus {
  authenticated: boolean;
  expired: boolean;
  user: { username: string; displayName: string; email: string } | null;
}

export interface AuthProviderExtension extends Extension {
  getAuthStatus(): Promise<AuthStatus>;
  onStartup?(mainWindow: BrowserWindow): Promise<void>;
}

export function isHostApiRouteExtension(ext: Extension): ext is HostApiRouteExtension {
  return 'getRouteHandler' in ext && typeof (ext as HostApiRouteExtension).getRouteHandler === 'function';
}

export function isMarketplaceProviderExtension(ext: Extension): ext is MarketplaceProviderExtension {
  return 'getCapability' in ext && 'search' in ext && 'install' in ext;
}

export function isAuthProviderExtension(ext: Extension): ext is AuthProviderExtension {
  return 'getAuthStatus' in ext && typeof (ext as AuthProviderExtension).getAuthStatus === 'function';
}

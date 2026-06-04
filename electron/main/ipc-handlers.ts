/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, resolve, sep, relative } from 'node:path';
import { syncMacTrafficLightPosition } from './traffic-light-layout';
import { GatewayManager } from '../gateway/manager';
import { ClawHubService } from '../gateway/clawhub';
import {
  type ProviderConfig,
} from '../utils/secure-storage';
import { getOpenClawStatus, getOpenClawSkillsDir, ensureDir, expandPath } from '../utils/paths';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../utils/store';
import {
  saveProviderKeyToOpenClaw,
  removeProviderFromOpenClaw,
} from '../utils/openclaw-auth';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { resolveAgentIdFromChannel } from '../utils/agent-config';
import { resolveAccountIdFromSessionHistory } from '../utils/session-util';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';
import { deviceOAuthManager } from '../utils/device-oauth';
import { browserOAuthManager } from '../utils/browser-oauth';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import { getRecentTokenUsageHistory } from '../utils/token-usage';
import { getProviderService } from '../services/providers/provider-service';
import {
  getOpenClawProviderKey,
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from '../services/providers/provider-validation';
import { appUpdater } from './updater';
import { GatewayRpcBackpressure } from '../gateway/rpc-backpressure';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createAppApi } from '../services/app-api';
import { createOpenClawApi } from '../services/openclaw-api';
import { createShellApi } from '../services/shell-api';
import { createDialogApi } from '../services/dialog-api';
import { createWindowApi } from '../services/window-api';
import { createUpdatesApi } from '../services/updates-api';
import { createUvApi } from '../services/uv-api';
import { createGatewayApi } from '../services/gateway-api';
import { createLogsApi } from '../services/logs-api';
import { createSettingsApi } from '../services/settings-api';
import { createChannelsApi } from '../services/channels-api';
import { createAgentsApi } from '../services/agents-api';
import { createChatApi } from '../services/chat-api';
import { createCronApi } from '../services/cron-api';
import { createFilesApi } from '../services/files-api';
import { createMediaApi } from '../services/media-api';
import { createProvidersApi } from '../services/providers-api';
import { createSessionsApi } from '../services/sessions-api';
import { createSkillsApi } from '../services/skills-api';
import { createUsageApi } from '../services/usage-api';
import {
  isLaunchAtStartupKey,
  isProxyKey,
  mapAppErrorCode,
  type AppRequest,
  type AppResponse,
} from './ipc/request-helpers';
import { createMenu } from './menu';

const gatewayRpcBackpressure = new GatewayRpcBackpressure();

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  hostApiRegistry: HostApiRegistry,
): void {
  // Unified request protocol (non-breaking: legacy channels remain available)
  registerUnifiedRequestHandlers(gatewayManager);

  // Typed host invoke handlers (new renderer facade; legacy channels remain available)
  registerTypedHostHandlers(gatewayManager, clawHubService, mainWindow, hostApiRegistry);

  // Gateway handlers
  registerGatewayHandlers(gatewayManager);

  // OpenClaw handlers
  registerOpenClawHandlers();

  // Provider handlers
  registerProviderHandlers(gatewayManager);

  // Shell handlers
  registerShellHandlers();

  // Dialog handlers
  registerDialogHandlers();

  // App handlers
  registerAppHandlers();

  // Settings handlers
  registerSettingsHandlers(gatewayManager);

  // Usage handlers
  registerUsageHandlers();

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager);

  // Window control handlers (for custom title bar on Windows/Linux)
  registerWindowHandlers(mainWindow);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);

  // File preview handlers (sandboxed read/write/list for inline viewer)
  registerFilePreviewHandlers();
}

function registerTypedHostHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  hostApiRegistry: HostApiRegistry,
): void {
  hostApiRegistry.registerCoreServices({
    app: createAppApi(),
    openclaw: createOpenClawApi(),
    shell: createShellApi(),
    dialog: createDialogApi(),
    window: createWindowApi(mainWindow),
    updates: createUpdatesApi(appUpdater),
    uv: createUvApi(),
    settings: createSettingsApi(gatewayManager),
    gateway: createGatewayApi(gatewayManager, gatewayRpcBackpressure),
    logs: createLogsApi(),
    channels: createChannelsApi({ gatewayManager, mainWindow }),
    agents: createAgentsApi({ gatewayManager }),
    providers: createProvidersApi({ gatewayManager, mainWindow }),
    files: createFilesApi(),
    media: createMediaApi(),
    sessions: createSessionsApi(),
    chat: createChatApi({ gatewayManager }),
    cron: createCronApi({ gatewayManager }),
    skills: createSkillsApi({ clawHubService, gatewayManager }),
    usage: createUsageApi(),
  });
  registerHostInvokeHandler(hostApiRegistry);
}

function registerUnifiedRequestHandlers(gatewayManager: GatewayManager): void {
  const providerService = getProviderService();
  const handleProxySettingsChange = async () => {
    const settings = await getAllSettings();
    await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
    await applyProxySettings(settings);
    if (gatewayManager.getStatus().state === 'running') {
      await gatewayManager.restart();
    }
  };

  ipcMain.handle('app:request', async (_, request: AppRequest): Promise<AppResponse> => {
    if (!request || typeof request.module !== 'string' || typeof request.action !== 'string') {
      return {
        id: request?.id,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid app request format' },
      };
    }

    try {
      let data: unknown;
      switch (request.module) {
        case 'app': {
          if (request.action === 'version') data = app.getVersion();
          else if (request.action === 'name') data = app.getName();
          else if (request.action === 'platform') data = process.platform;
          else {
            return {
              id: request.id,
              ok: false,
              error: {
                code: 'UNSUPPORTED',
                message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
              },
            };
          }
          break;
        }
        case 'provider': {
          if (request.action === 'list') {
            data = await providerService.listLegacyProvidersWithKeyInfo();
            break;
          }
          if (request.action === 'get') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.get payload');
            data = await providerService.getLegacyProvider(providerId);
            break;
          }
          if (request.action === 'getDefault') {
            data = await providerService.getDefaultLegacyProvider();
            break;
          }
          if (request.action === 'hasApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.hasApiKey payload');
            data = await providerService.hasLegacyProviderApiKey(providerId);
            break;
          }
          if (request.action === 'getApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.getApiKey payload');
            data = await providerService.getLegacyProviderApiKey(providerId);
            break;
          }
          if (request.action === 'validateKey') {
            const payload = request.payload as
              | { providerId?: string; apiKey?: string; options?: { baseUrl?: string; apiProtocol?: string } }
              | [string, string, { baseUrl?: string; apiProtocol?: string }?]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            const options = Array.isArray(payload) ? payload[2] : payload?.options;
            if (!providerId || typeof apiKey !== 'string') {
              throw new Error('Invalid provider.validateKey payload');
            }

            const provider = await providerService.getLegacyProvider(providerId);
            const providerType = provider?.type || providerId;
            const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
            const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;
            const resolvedProtocol = options?.apiProtocol || provider?.apiProtocol;
            data = await validateApiKeyWithProvider(providerType, apiKey, {
              baseUrl: resolvedBaseUrl,
              apiProtocol: resolvedProtocol,
            });
            break;
          }
          if (request.action === 'save') {
            const payload = request.payload as
              | { config?: ProviderConfig; apiKey?: string }
              | [ProviderConfig, string?]
              | undefined;
            const config = Array.isArray(payload) ? payload[0] : payload?.config;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            if (!config) throw new Error('Invalid provider.save payload');

            try {
              await providerService.saveLegacyProvider(config);

              if (apiKey !== undefined) {
                const trimmedKey = apiKey.trim();
                if (trimmedKey) {
                  await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
                }
              }

              try {
                await syncSavedProviderToRuntime(config, apiKey, gatewayManager);
              } catch (err) {
                console.warn('Failed to sync openclaw provider config:', err);
              }

              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'delete') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.delete payload');

            try {
              const existing = await providerService.getLegacyProvider(providerId);
              await providerService.deleteLegacyProvider(providerId);
              if (existing?.type) {
                try {
                  await syncDeletedProviderToRuntime(existing, providerId, gatewayManager);
                } catch (err) {
                  console.warn('Failed to completely remove provider from OpenClaw:', err);
                }
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'setApiKey') {
            const payload = request.payload as
              | { providerId?: string; apiKey?: string }
              | [string, string]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const apiKey = Array.isArray(payload) ? payload[1] : payload?.apiKey;
            if (!providerId || typeof apiKey !== 'string') throw new Error('Invalid provider.setApiKey payload');

            try {
              await providerService.setLegacyProviderApiKey(providerId, apiKey);
              const provider = await providerService.getLegacyProvider(providerId);
              const providerType = provider?.type || providerId;
              const ock = getOpenClawProviderKey(providerType, providerId);
              try {
                await saveProviderKeyToOpenClaw(ock, apiKey);
              } catch (err) {
                console.warn('Failed to save key to OpenClaw auth-profiles:', err);
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'updateWithKey') {
            const payload = request.payload as
              | { providerId?: string; updates?: Partial<ProviderConfig>; apiKey?: string }
              | [string, Partial<ProviderConfig>, string?]
              | undefined;
            const providerId = Array.isArray(payload) ? payload[0] : payload?.providerId;
            const updates = Array.isArray(payload) ? payload[1] : payload?.updates;
            const apiKey = Array.isArray(payload) ? payload[2] : payload?.apiKey;
            if (!providerId || !updates) throw new Error('Invalid provider.updateWithKey payload');

            const existing = await providerService.getLegacyProvider(providerId);
            if (!existing) {
              data = { success: false, error: 'Provider not found' };
              break;
            }

            const previousKey = await providerService.getLegacyProviderApiKey(providerId);
            const previousOck = getOpenClawProviderKey(existing.type, providerId);

            try {
              const nextConfig: ProviderConfig = {
                ...existing,
                ...updates,
                updatedAt: new Date().toISOString(),
              };
              const ock = getOpenClawProviderKey(nextConfig.type, providerId);
              await providerService.saveLegacyProvider(nextConfig);

              if (apiKey !== undefined) {
                const trimmedKey = apiKey.trim();
                if (trimmedKey) {
                  await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
                  await saveProviderKeyToOpenClaw(ock, trimmedKey);
                } else {
                  await providerService.deleteLegacyProviderApiKey(providerId);
                  await removeProviderFromOpenClaw(ock);
                }
              }

              try {
                await syncUpdatedProviderToRuntime(nextConfig, apiKey, gatewayManager);
              } catch (err) {
                console.warn('Failed to sync openclaw config after provider update:', err);
              }

              data = { success: true };
            } catch (error) {
              try {
                await providerService.saveLegacyProvider(existing);
                if (previousKey) {
                  await providerService.setLegacyProviderApiKey(providerId, previousKey);
                  await saveProviderKeyToOpenClaw(previousOck, previousKey);
                } else {
                  await providerService.deleteLegacyProviderApiKey(providerId);
                  await removeProviderFromOpenClaw(previousOck);
                }
              } catch (rollbackError) {
                console.warn('Failed to rollback provider updateWithKey:', rollbackError);
              }

              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'deleteApiKey') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.deleteApiKey payload');
            try {
              await providerService.deleteLegacyProviderApiKey(providerId);
              const provider = await providerService.getLegacyProvider(providerId);
              const providerType = provider?.type || providerId;
              const ock = getOpenClawProviderKey(providerType, providerId);
              try {
                if (ock) {
                  await removeProviderFromOpenClaw(ock);
                }
              } catch (err) {
                console.warn('Failed to completely remove provider from OpenClaw:', err);
              }
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'setDefault') {
            const payload = request.payload as { providerId?: string } | string | undefined;
            const providerId = typeof payload === 'string' ? payload : payload?.providerId;
            if (!providerId) throw new Error('Invalid provider.setDefault payload');

            try {
              await providerService.setDefaultLegacyProvider(providerId);
              const provider = await providerService.getLegacyProvider(providerId);
              if (provider) {
                try {
                  await syncDefaultProviderToRuntime(providerId, gatewayManager);
                } catch (err) {
                  console.warn('Failed to set OpenClaw default model:', err);
                }
              }

              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'update': {
          if (request.action === 'status') {
            data = appUpdater.getStatus();
            break;
          }
          if (request.action === 'version') {
            data = appUpdater.getCurrentVersion();
            break;
          }
          if (request.action === 'check') {
            try {
              await appUpdater.checkForUpdates();
              data = { success: true, status: appUpdater.getStatus() };
            } catch (error) {
              data = { success: false, error: String(error), status: appUpdater.getStatus() };
            }
            break;
          }
          if (request.action === 'download') {
            try {
              await appUpdater.downloadUpdate();
              data = { success: true };
            } catch (error) {
              data = { success: false, error: String(error) };
            }
            break;
          }
          if (request.action === 'install') {
            appUpdater.quitAndInstall();
            data = { success: true };
            break;
          }
          if (request.action === 'setChannel') {
            const payload = request.payload as { channel?: 'stable' | 'beta' | 'dev' } | 'stable' | 'beta' | 'dev' | undefined;
            const channel = typeof payload === 'string' ? payload : payload?.channel;
            if (!channel) throw new Error('Invalid update.setChannel payload');
            appUpdater.setChannel(channel);
            data = { success: true };
            break;
          }
          if (request.action === 'setAutoDownload') {
            const payload = request.payload as { enable?: boolean } | boolean | undefined;
            const enable = typeof payload === 'boolean' ? payload : payload?.enable;
            if (typeof enable !== 'boolean') throw new Error('Invalid update.setAutoDownload payload');
            appUpdater.setAutoDownload(enable);
            data = { success: true };
            break;
          }
          if (request.action === 'cancelAutoInstall') {
            appUpdater.cancelAutoInstall();
            data = { success: true };
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'usage': {
          if (request.action === 'recentTokenHistory') {
            const payload = request.payload as { limit?: number } | number | undefined;
            const limit = typeof payload === 'number' ? payload : payload?.limit;
            const safeLimit = typeof limit === 'number' && Number.isFinite(limit)
              ? Math.max(Math.floor(limit), 1)
              : undefined;
            data = await getRecentTokenUsageHistory(safeLimit);
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        case 'settings': {
          if (request.action === 'getAll') {
            data = await getAllSettings();
            break;
          }
          if (request.action === 'get') {
            const payload = request.payload as { key?: keyof AppSettings } | [keyof AppSettings] | undefined;
            const key = Array.isArray(payload) ? payload[0] : payload?.key;
            if (!key) throw new Error('Invalid settings.get payload');
            data = await getSetting(key);
            break;
          }
          if (request.action === 'set') {
            const payload = request.payload as
              | { key?: keyof AppSettings; value?: AppSettings[keyof AppSettings] }
              | [keyof AppSettings, AppSettings[keyof AppSettings]]
              | undefined;
            const key = Array.isArray(payload) ? payload[0] : payload?.key;
            const value = Array.isArray(payload) ? payload[1] : payload?.value;
            if (!key) throw new Error('Invalid settings.set payload');
            await setSetting(key, value as never);
            if (isProxyKey(key)) {
              await handleProxySettingsChange();
            }
            if (isLaunchAtStartupKey(key)) {
              await syncLaunchAtStartupSettingFromStore();
            }
            if (key === 'language') {
              await createMenu(typeof value === 'string' ? value : undefined);
            }
            data = { success: true };
            break;
          }
          if (request.action === 'setMany') {
            const patch = (request.payload ?? {}) as Partial<AppSettings>;
            const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
            for (const [key, value] of entries) {
              await setSetting(key, value as never);
            }
            if (entries.some(([key]) => isProxyKey(key))) {
              await handleProxySettingsChange();
            }
            if (entries.some(([key]) => isLaunchAtStartupKey(key))) {
              await syncLaunchAtStartupSettingFromStore();
            }
            if (entries.some(([key]) => key === 'language')) {
              await createMenu(typeof patch.language === 'string' ? patch.language : undefined);
            }
            data = { success: true };
            break;
          }
          if (request.action === 'reset') {
            await resetSettings();
            const settings = await getAllSettings();
            await handleProxySettingsChange();
            await syncLaunchAtStartupSettingFromStore();
            await createMenu(settings.language);
            data = { success: true, settings };
            break;
          }
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
        }
        default:
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'UNSUPPORTED',
              message: `APP_REQUEST_UNSUPPORTED:${request.module}.${request.action}`,
            },
          };
      }

      return { id: request.id, ok: true, data };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: mapAppErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
}

/**
 * Cron maintenance
 */
function registerCronHandlers(gatewayManager: GatewayManager): void {
  // Periodic cron job repair: checks for jobs with undefined agentId and repairs them
  // This handles cases where cron jobs were created via openclaw CLI without specifying agent
  const CRON_AGENT_REPAIR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  let _lastRepairErrorLogAt = 0;
  const REPAIR_ERROR_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    try {
      const status = gatewayManager.getStatus();
      if (status.state !== 'running') return;

      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const jobs = Array.isArray(result)
        ? result
        : (result as { jobs?: Array<{ id: string; name: string; sessionTarget?: string; payload?: { kind: string }; delivery?: { mode: string; channel?: string; to?: string; accountId?: string }; state?: Record<string, unknown> }> })?.jobs ?? [];

      for (const job of jobs) {
        const jobAgentId = (job as unknown as { agentId?: string }).agentId;
        if (
          (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
          job.payload?.kind === 'agentTurn' &&
          job.delivery?.mode === 'announce' &&
          job.delivery?.channel &&
          jobAgentId === undefined
        ) {
          const channel = job.delivery.channel;
          const accountId = job.delivery.accountId;
          const toAddress = job.delivery.to;

          let correctAgentId = await resolveAgentIdFromChannel(channel, accountId);

          // If no accountId, try to resolve it from session history
          let resolvedAccountId: string | null = null;
          if (!correctAgentId && !accountId && toAddress) {
            resolvedAccountId = await resolveAccountIdFromSessionHistory(toAddress, channel);
            if (resolvedAccountId) {
              correctAgentId = await resolveAgentIdFromChannel(channel, resolvedAccountId);
            }
          }

          if (correctAgentId) {
            console.debug(`Periodic repair: job "${job.name}" agentId undefined -> "${correctAgentId}"`);
            // When accountId was resolved via to address, include it in the patch
            const patch: Record<string, unknown> = { agentId: correctAgentId };
            if (resolvedAccountId && !accountId) {
              patch.delivery = { accountId: resolvedAccountId };
            }
            await gatewayManager.rpc('cron.update', { id: job.id, patch });
          }
        }
      }
    } catch (error) {
      const now = Date.now();
      if (now - _lastRepairErrorLogAt >= REPAIR_ERROR_LOG_INTERVAL_MS) {
        _lastRepairErrorLogAt = now;
        console.debug('Periodic cron repair error:', error);
      }
    }
  }, CRON_AGENT_REPAIR_INTERVAL_MS);
}

/**
 * Gateway-related IPC handlers
 */
function registerGatewayHandlers(gatewayManager: GatewayManager): void {
  // Get Gateway status
  ipcMain.handle('gateway:status', () => {
    return gatewayManager.getStatus();
  });

  // Gateway RPC call
  ipcMain.handle('gateway:rpc', async (_, method: string, params?: unknown, timeoutMs?: number) => {
    try {
      const result = await gatewayRpcBackpressure.run(
        method,
        params,
        timeoutMs,
        (rpcMethod, rpcParams, rpcTimeoutMs) => gatewayManager.rpc(rpcMethod, rpcParams, rpcTimeoutMs),
      );
      return { success: true, result };
    } catch (error) {
      logger.warn(`[gateway:rpc] ${method} failed (timeoutMs=${timeoutMs ?? 30000}): ${String(error)}`);
      return { success: false, error: String(error) };
    }
  });

  // Gateway events are bridged once in main/index.ts through the typed
  // hostEvents surface. Keeping listener forwarding here would double-deliver
  // streaming/runtime events to the renderer.
}

/**
 * OpenClaw-related IPC handlers
 * For checking package status and channel configuration
 */
function registerOpenClawHandlers(): void {
  // Get OpenClaw package status
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  // Get the OpenClaw skills directory (~/.openclaw/skills)
  ipcMain.handle('openclaw:getSkillsDir', () => {
    const dir = getOpenClawSkillsDir();
    ensureDir(dir);
    return dir;
  });

  // Get a shell command to run OpenClaw CLI without modifying PATH
  ipcMain.handle('openclaw:getCliCommand', () => {
    try {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Forward events to renderer
  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('channel:whatsapp-qr', data);
    }
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });
}

/**
 * Provider-related IPC handlers
 */
function registerProviderHandlers(gatewayManager: GatewayManager): void {
  const providerService = getProviderService();
  const legacyProviderChannelsWarned = new Set<string>();
  const logLegacyProviderChannel = (channel: string): void => {
    if (legacyProviderChannelsWarned.has(channel)) return;
    legacyProviderChannelsWarned.add(channel);
    logger.warn(
      `[provider-migration] Legacy IPC channel "${channel}" is deprecated. Prefer app:request provider actions and account APIs.`,
    );
  };

  // Listen for OAuth success to automatically restart the Gateway with new tokens/configs.
  // Keep a longer debounce (8s) so provider config writes and OAuth token persistence
  // can settle before applying the process-level refresh.
  deviceOAuthManager.on('oauth:success', ({ provider, accountId }) => {
    logger.info(`[IPC] Scheduling Gateway restart after ${provider} OAuth success for ${accountId}...`);
    gatewayManager.debouncedRestart(8000);
  });
  browserOAuthManager.on('oauth:success', ({ provider, accountId }) => {
    logger.info(`[IPC] Scheduling Gateway restart after ${provider} OAuth success for ${accountId}...`);
    gatewayManager.debouncedRestart(8000);
  });

  // Get all providers with key info
  ipcMain.handle('provider:list', async () => {
    logLegacyProviderChannel('provider:list');
    return await providerService.listLegacyProvidersWithKeyInfo();
  });

  // Get a specific provider
  ipcMain.handle('provider:get', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:get');
    return await providerService.getLegacyProvider(providerId);
  });

  // Save a provider configuration
  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    logLegacyProviderChannel('provider:save');
    try {
      // Save the provider config
      await providerService.saveLegacyProvider(config);

      // Store the API key if provided
      if (apiKey !== undefined) {
        const trimmedKey = apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);

          // Also write to OpenClaw auth-profiles.json so the gateway can use it
          try {
            await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
          } catch (err) {
            console.warn('Failed to save key to OpenClaw auth-profiles:', err);
          }
        }
      }

      // Sync the provider configuration to openclaw.json so Gateway knows about it
      try {
        await syncSavedProviderToRuntime(config, apiKey, gatewayManager);
      } catch (err) {
        console.warn('Failed to sync openclaw provider config:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete a provider
  ipcMain.handle('provider:delete', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:delete');
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      await providerService.deleteLegacyProvider(providerId);

      // Best-effort cleanup in OpenClaw auth profiles & openclaw.json config
      if (existing?.type) {
        try {
          await syncDeletedProviderToRuntime(existing, providerId, gatewayManager);
        } catch (err) {
          console.warn('Failed to completely remove provider from OpenClaw:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update API key for a provider
  ipcMain.handle('provider:setApiKey', async (_, providerId: string, apiKey: string) => {
    logLegacyProviderChannel('provider:setApiKey');
    try {
      await providerService.setLegacyProviderApiKey(providerId, apiKey);

      // Also write to OpenClaw auth-profiles.json
      const provider = await providerService.getLegacyProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        await syncProviderApiKeyToRuntime(providerType, providerId, apiKey);
      } catch (err) {
        console.warn('Failed to save key to OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Atomically update provider config and API key
  ipcMain.handle(
    'provider:updateWithKey',
    async (
      _,
      providerId: string,
      updates: Partial<ProviderConfig>,
      apiKey?: string
    ) => {
      logLegacyProviderChannel('provider:updateWithKey');
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const previousKey = await providerService.getLegacyProviderApiKey(providerId);
      const previousOck = getOpenClawProviderKey(existing.type, providerId);

      try {
        const nextConfig: ProviderConfig = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const ock = getOpenClawProviderKey(nextConfig.type, providerId);

        await providerService.saveLegacyProvider(nextConfig);

        if (apiKey !== undefined) {
          const trimmedKey = apiKey.trim();
          if (trimmedKey) {
            await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
            await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
          } else {
            await providerService.deleteLegacyProviderApiKey(providerId);
            await removeProviderFromOpenClaw(ock);
          }
        }

        // Sync the provider configuration to openclaw.json so Gateway knows about it
        try {
          await syncUpdatedProviderToRuntime(nextConfig, apiKey, gatewayManager);
        } catch (err) {
          console.warn('Failed to sync openclaw config after provider update:', err);
        }

        return { success: true };
      } catch (error) {
        // Best-effort rollback to keep config/key consistent.
        try {
          await providerService.saveLegacyProvider(existing);
          if (previousKey) {
            await providerService.setLegacyProviderApiKey(providerId, previousKey);
            await saveProviderKeyToOpenClaw(previousOck, previousKey);
          } else {
            await providerService.deleteLegacyProviderApiKey(providerId);
            await removeProviderFromOpenClaw(previousOck);
          }
        } catch (rollbackError) {
          console.warn('Failed to rollback provider updateWithKey:', rollbackError);
        }

        return { success: false, error: String(error) };
      }
    }
  );

  // Delete API key for a provider
  ipcMain.handle('provider:deleteApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:deleteApiKey');
    try {
      await providerService.deleteLegacyProviderApiKey(providerId);

      // Keep OpenClaw auth-profiles.json in sync with local key storage
      const provider = await providerService.getLegacyProvider(providerId);
      try {
        await syncDeletedProviderApiKeyToRuntime(provider, providerId);
      } catch (err) {
        console.warn('Failed to completely remove provider from OpenClaw:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a provider has an API key
  ipcMain.handle('provider:hasApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:hasApiKey');
    return await providerService.hasLegacyProviderApiKey(providerId);
  });

  // Get the actual API key (for internal use only - be careful!)
  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:getApiKey');
    return await providerService.getLegacyProviderApiKey(providerId);
  });

  // Set default provider and update OpenClaw default model
  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    logLegacyProviderChannel('provider:setDefault');
    try {
      await providerService.setDefaultLegacyProvider(providerId);

      // Update OpenClaw config to use this provider's default model
      try {
        await syncDefaultProviderToRuntime(providerId, gatewayManager);
      } catch (err) {
        console.warn('Failed to set OpenClaw default model:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });



  // Get default provider
  ipcMain.handle('provider:getDefault', async () => {
    logLegacyProviderChannel('provider:getDefault');
    return await providerService.getDefaultLegacyProvider();
  });

  // Validate API key by making a real test request to the provider.
  // providerId can be either a stored provider ID or a provider type.
  ipcMain.handle(
    'provider:validateKey',
    async (
      _,
      providerId: string,
      apiKey: string,
      options?: { baseUrl?: string; apiProtocol?: string }
    ) => {
      logLegacyProviderChannel('provider:validateKey');
      try {
        // First try to get existing provider
        const provider = await providerService.getLegacyProvider(providerId);

        // Use provider.type if provider exists, otherwise use providerId as the type
        // This allows validation during setup when provider hasn't been saved yet
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        // Prefer caller-supplied baseUrl (live form value) over persisted config.
        // This ensures Setup/Settings validation reflects unsaved edits immediately.
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;
        const resolvedProtocol = options?.apiProtocol || provider?.apiProtocol;

        console.log(`[clawx-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, {
          baseUrl: resolvedBaseUrl,
          apiProtocol: resolvedProtocol,
        });
      } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}

/**
 * Shell-related IPC handlers
 */
function expandShellPath(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith(`~${sep}`) || input.startsWith('~/') || input.startsWith('~\\')) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

function registerShellHandlers(): void {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // Open path in file explorer
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(expandShellPath(path));
  });

  // Open path
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return await shell.openPath(expandShellPath(path));
  });
}

/**
 * Dialog-related IPC handlers
 */
function registerDialogHandlers(): void {
  // Show open dialog
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  });

  // Show message box
  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    const result = await dialog.showMessageBox(options);
    return result;
  });
}

/**
 * App-related IPC handlers
 */
function registerAppHandlers(): void {
  // Get app version
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Get app name
  ipcMain.handle('app:name', () => {
    return app.getName();
  });

  // Get platform
  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

}

function registerSettingsHandlers(gatewayManager: GatewayManager): void {
  const handleProxySettingsChange = async () => {
    const settings = await getAllSettings();
    await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
    await applyProxySettings(settings);
    if (gatewayManager.getStatus().state === 'running') {
      await gatewayManager.restart();
    }
  };

  ipcMain.handle('settings:get', async (_, key: keyof AppSettings) => {
    return await getSetting(key);
  });

  ipcMain.handle('settings:getAll', async () => {
    return await getAllSettings();
  });

  ipcMain.handle('settings:set', async (_, key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
    await setSetting(key, value as never);

    if (
      key === 'proxyEnabled' ||
      key === 'proxyServer' ||
      key === 'proxyHttpServer' ||
      key === 'proxyHttpsServer' ||
      key === 'proxyAllServer' ||
      key === 'proxyBypassRules'
    ) {
      await handleProxySettingsChange();
    }
    if (key === 'launchAtStartup') {
      await syncLaunchAtStartupSettingFromStore();
    }
    if (key === 'language') {
      await createMenu(typeof value === 'string' ? value : undefined);
    }

    return { success: true };
  });

  ipcMain.handle('settings:setMany', async (_, patch: Partial<AppSettings>) => {
    const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
    for (const [key, value] of entries) {
      await setSetting(key, value as never);
    }

    if (entries.some(([key]) =>
      key === 'proxyEnabled' ||
      key === 'proxyServer' ||
      key === 'proxyHttpServer' ||
      key === 'proxyHttpsServer' ||
      key === 'proxyAllServer' ||
      key === 'proxyBypassRules'
    )) {
      await handleProxySettingsChange();
    }
    if (entries.some(([key]) => key === 'launchAtStartup')) {
      await syncLaunchAtStartupSettingFromStore();
    }
    if (entries.some(([key]) => key === 'language')) {
      await createMenu(typeof patch.language === 'string' ? patch.language : undefined);
    }

    return { success: true };
  });

  ipcMain.handle('settings:reset', async () => {
    await resetSettings();
    const settings = await getAllSettings();
    await handleProxySettingsChange();
    await syncLaunchAtStartupSettingFromStore();
    await createMenu(settings.language);
    return { success: true, settings };
  });
}
function registerUsageHandlers(): void {
  ipcMain.handle('usage:recentTokenHistory', async (_, limit?: number) => {
    const safeLimit = typeof limit === 'number' && Number.isFinite(limit)
      ? Math.max(Math.floor(limit), 1)
      : undefined;
    return await getRecentTokenUsageHistory(safeLimit);
  });
}
/**
 * Window control handlers (for custom title bar on Windows)
 */
function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:syncTrafficLightPosition', (_, sidebarCollapsed: unknown) => {
    if (typeof sidebarCollapsed !== 'boolean') {
      return;
    }
    syncMacTrafficLightPosition(mainWindow, sidebarCollapsed);
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized();
  });
}

// ── Mime type helpers ────────────────────────────────────────────

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');

// ── File preview (sandboxed) ──────────────────────────────────────────
//
// IPC channels backing the in-app file preview / overlay components.
// Reads, writes, dir listings and tree scans are restricted to a small
// allowlist of roots so the renderer can never reach arbitrary disk paths
// (defence in depth on top of contextIsolation).

const FILE_PREVIEW_MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB
// Binary preview ceiling for inline PDF / spreadsheet rendering.  Anything
// over this still falls back to "open with system app" via the existing
// confirmAndOpenFile flow so we never balloon the renderer with huge
// buffers, but typical work-product PDFs / XLSX files (a few MB) sail
// through.
const FILE_PREVIEW_MAX_BINARY_BYTES = 50 * 1024 * 1024; // 50 MB
const FILE_PREVIEW_TREE_MAX_DEPTH = 6;
const FILE_PREVIEW_TREE_MAX_NODES = 5000;
const FILE_PREVIEW_DIR_BLACKLIST = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

interface FilePreviewTreeOptions {
  maxDepth?: number;
  maxNodes?: number;
  includeHidden?: boolean;
}

interface FilePreviewTreeNode {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: FilePreviewTreeNode[];
}

function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  // Windows file systems are case-insensitive: realpath() returns the
  // on-disk casing while `homedir()` / `resolve()` may preserve whatever
  // casing the OS reported, leading to false `outsideSandbox` rejections
  // (e.g. `C:\Users\Foo\.openclaw\…` vs `c:\users\foo\.openclaw\…`).
  // Compare case-insensitively on Windows; keep strict comparison on
  // POSIX so we don't accidentally widen the sandbox there.
  if (process.platform === 'win32') {
    const cl = c.toLowerCase();
    const pl = p.toLowerCase();
    return cl === pl || cl.startsWith(pl + sep);
  }
  return c === p || c.startsWith(p + sep);
}

/**
 * Roots inside which the file preview pipeline can READ AND WRITE.
 * These are the user's own data directories — modifying them is safe.
 */
function getFilePreviewWriteRoots(): string[] {
  const roots: string[] = [];
  const openclawDir = join(homedir(), '.openclaw');
  roots.push(resolve(openclawDir));
  try {
    roots.push(resolve(app.getPath('userData')));
  } catch {
    // ignore — userData should always exist
  }
  roots.push(resolve(OUTBOUND_DIR));
  return roots;
}

interface ResolvedSandboxedPath {
  realPath: string;
  /** True when the resolved path lives in a read-only-only root (e.g. bundled skill). */
  readOnly: boolean;
}

async function resolveSandboxedPath(
  input: string,
  mode: 'read' | 'write' = 'read',
): Promise<ResolvedSandboxedPath> {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('outsideSandbox');
  }
  // OpenClaw stores agent.workspace / agentDir paths as `~/.openclaw/...`
  // literals; expand the tilde before realpath so sandbox resolution
  // matches what the user actually sees on disk.
  const expanded = expandPath(input);
  const fsP = await import('fs/promises');
  let real: string;
  try {
    real = await fsP.realpath(expanded);
  } catch {
    // Path may not exist yet (e.g. write that should fail later);
    // resolve without realpath fallback so the sandbox check is still applied.
    real = resolve(expanded);
  }
  const writeRoots = getFilePreviewWriteRoots();
  if (writeRoots.some((root) => isPathInside(real, root))) {
    return { realPath: real, readOnly: false };
  }
  if (mode === 'write') {
    // Preview is broadly read-only, but mutations stay confined to the
    // app-owned write roots. This avoids path-specific allowlists (which
    // are fragile on Windows, OneDrive, localized folders, Chinese user
    // names, etc.) while preserving a strict write boundary.
    throw new Error('readOnlyRoot');
  }

  // Read-only preview should work for any real local path surfaced by the
  // desktop app/runtime. `realpath()` above canonicalizes Windows casing,
  // Unicode path segments and symlinks; individual handlers still enforce
  // file-vs-directory checks, size caps, hidden directory skips and binary
  // detection where appropriate.
  return { realPath: real, readOnly: true };
}

function looksLikeBinary(buf: Buffer): boolean {
  // Treat presence of a NUL byte in the first 8 KB as binary, matching
  // the heuristic used by isbinaryfile / git.
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function shouldSkipDirEntry(name: string, includeHidden: boolean): boolean {
  if (FILE_PREVIEW_DIR_BLACKLIST.has(name)) return true;
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function shouldSkipFileEntry(name: string, includeHidden: boolean): boolean {
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function registerFilePreviewHandlers(): void {
  ipcMain.handle('file:readText', async (_, inputPath: string) => {
    try {
      const { realPath: real, readOnly } = await resolveSandboxedPath(inputPath, 'read');
      const fsP = await import('fs/promises');
      const stat = await fsP.stat(real);
      if (!stat.isFile()) {
        return { ok: false, error: 'notFound' };
      }
      if (stat.size > FILE_PREVIEW_MAX_TEXT_BYTES) {
        return { ok: false, error: 'tooLarge', size: stat.size };
      }
      const buf = await fsP.readFile(real);
      if (looksLikeBinary(buf)) {
        return { ok: false, error: 'binary', size: stat.size };
      }
      return {
        ok: true,
        content: buf.toString('utf8'),
        mimeType: getMimeType(extname(real)),
        size: stat.size,
        readOnly,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message.includes('ENOENT')) {
        return { ok: false, error: 'notFound' };
      }
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('file:readBinary', async (_, inputPath: string, opts?: { maxBytes?: number }) => {
    try {
      const { realPath: real, readOnly } = await resolveSandboxedPath(inputPath, 'read');
      const fsP = await import('fs/promises');
      const stat = await fsP.stat(real);
      if (!stat.isFile()) {
        return { ok: false, error: 'notFound' };
      }
      const cap = Math.max(
        1,
        Math.min(opts?.maxBytes ?? FILE_PREVIEW_MAX_BINARY_BYTES, FILE_PREVIEW_MAX_BINARY_BYTES),
      );
      if (stat.size > cap) {
        return { ok: false, error: 'tooLarge', size: stat.size };
      }
      const buf = await fsP.readFile(real);
      // Electron serialises Node Buffers as ArrayBuffer-backed Uint8Arrays
      // through structured clone, so the renderer receives a Uint8Array
      // without the heavyweight base64 round-trip.
      const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return {
        ok: true,
        data: view,
        mimeType: getMimeType(extname(real)),
        size: stat.size,
        readOnly,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message.includes('ENOENT')) {
        return { ok: false, error: 'notFound' };
      }
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('file:writeText', async (_, inputPath: string, content: string) => {
    try {
      if (typeof content !== 'string') {
        return { ok: false, error: 'invalidContent' };
      }
      if (Buffer.byteLength(content, 'utf8') > FILE_PREVIEW_MAX_TEXT_BYTES) {
        return { ok: false, error: 'tooLarge' };
      }
      const { realPath: real } = await resolveSandboxedPath(inputPath, 'write');
      const fsP = await import('fs/promises');
      // Only allow writing existing files to avoid surprise creation.
      let stat;
      try {
        stat = await fsP.stat(real);
      } catch {
        return { ok: false, error: 'notFound' };
      }
      if (!stat.isFile()) {
        return { ok: false, error: 'notFound' };
      }
      await fsP.writeFile(real, content, 'utf8');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message === 'readOnlyRoot') {
        return { ok: false, error: 'readOnlyRoot' };
      }
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('file:stat', async (_, inputPath: string) => {
    try {
      const { realPath: real, readOnly } = await resolveSandboxedPath(inputPath, 'read');
      const fsP = await import('fs/promises');
      const stat = await fsP.stat(real);
      return {
        ok: true,
        size: stat.size,
        mtime: stat.mtimeMs,
        isFile: stat.isFile(),
        isDir: stat.isDirectory(),
        readOnly,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message.includes('ENOENT')) {
        return { ok: false, error: 'notFound' };
      }
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('file:listDir', async (_, inputPath: string) => {
    try {
      const { realPath: real } = await resolveSandboxedPath(inputPath, 'read');
      const fsP = await import('fs/promises');
      const dirents = await fsP.readdir(real, { withFileTypes: true });
      const entries = await Promise.all(dirents.map(async (entry) => {
        const abs = join(real, entry.name);
        let size = 0;
        try {
          if (entry.isFile()) {
            size = (await fsP.stat(abs)).size;
          }
        } catch {
          // non-fatal
        }
        return {
          name: entry.name,
          path: abs,
          isDir: entry.isDirectory(),
          size,
        };
      }));
      return { ok: true, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message.includes('ENOENT')) {
        return { ok: false, error: 'notFound' };
      }
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('file:listTree', async (_, inputPath: string, opts?: FilePreviewTreeOptions) => {
    try {
      const { realPath: real } = await resolveSandboxedPath(inputPath, 'read');
      const fsP = await import('fs/promises');
      const stat = await fsP.stat(real);
      if (!stat.isDirectory()) {
        return { ok: false, error: 'notDirectory' };
      }
      const maxDepth = Math.max(1, Math.min(opts?.maxDepth ?? FILE_PREVIEW_TREE_MAX_DEPTH, 12));
      const maxNodes = Math.max(1, Math.min(opts?.maxNodes ?? FILE_PREVIEW_TREE_MAX_NODES, 50000));
      const includeHidden = !!opts?.includeHidden;

      let nodeCount = 0;
      let truncated = false;

      const walk = async (
        absDir: string,
        depth: number,
      ): Promise<FilePreviewTreeNode[] | undefined> => {
        if (depth > maxDepth || truncated) return undefined;
        let dirents;
        try {
          dirents = await fsP.readdir(absDir, { withFileTypes: true });
        } catch {
          return [];
        }
        const children: FilePreviewTreeNode[] = [];
        for (const entry of dirents) {
          if (truncated) break;
          const isDir = entry.isDirectory();
          const isFile = entry.isFile();
          if (!isDir && !isFile) continue;
          if (isDir && shouldSkipDirEntry(entry.name, includeHidden)) continue;
          if (isFile && shouldSkipFileEntry(entry.name, includeHidden)) continue;
          if (nodeCount >= maxNodes) {
            truncated = true;
            break;
          }
          nodeCount += 1;
          const abs = join(absDir, entry.name);
          // Normalise relPath to forward slashes for renderer use — the
          // renderer derives the same value cross-platform when looking
          // up a node by path, and Windows backslashes look out of place
          // in URLs / display strings.
          const rel = relative(real, abs).split(sep).join('/');
          const node: FilePreviewTreeNode = {
            name: entry.name,
            relPath: rel,
            absPath: abs,
            isDir,
          };
          if (isFile) {
            try {
              const fstat = await fsP.stat(abs);
              node.size = fstat.size;
              node.mtime = fstat.mtimeMs;
            } catch {
              // non-fatal
            }
          } else if (isDir) {
            try {
              const fstat = await fsP.stat(abs);
              node.mtime = fstat.mtimeMs;
            } catch {
              // non-fatal
            }
            node.children = await walk(abs, depth + 1) ?? [];
          }
          children.push(node);
        }
        children.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return children;
      };

      const root: FilePreviewTreeNode = {
        name: basename(real) || real,
        relPath: '',
        absPath: real,
        isDir: true,
        mtime: stat.mtimeMs,
        children: (await walk(real, 1)) ?? [],
      };

      return { ok: true, root, truncated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'outsideSandbox') {
        return { ok: false, error: 'outsideSandbox' };
      }
      if (message.includes('ENOENT')) {
        return { ok: false, error: 'notFound' };
      }
      return { ok: false, error: message };
    }
  });
}

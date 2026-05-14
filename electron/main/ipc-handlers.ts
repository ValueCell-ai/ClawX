/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename, resolve, sep, relative } from 'node:path';
import crypto from 'node:crypto';
import { GatewayManager } from '../gateway/manager';
import { ClawHubService, ClawHubSearchParams, ClawHubInstallParams, ClawHubUninstallParams } from '../gateway/clawhub';
import {
  type ProviderConfig,
} from '../utils/secure-storage';
import { getOpenClawStatus, getOpenClawDir, getOpenClawConfigDir, getOpenClawSkillsDir, ensureDir, expandPath } from '../utils/paths';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import { getAllSettings, getSetting, resetSettings, setSetting, type AppSettings } from '../utils/store';
import {
  saveProviderKeyToOpenClaw,
  removeProviderFromOpenClaw,
} from '../utils/openclaw-auth';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { logger } from '../utils/logger';
import { resolveAgentIdFromChannel } from '../utils/agent-config';
import { resolveAccountIdFromSessionHistory } from '../utils/session-util';
import {
  removeSessionEntry,
  resolveSessionTranscriptPath,
  sweepSessionArtefacts,
} from '../utils/session-files';
import {
  saveChannelConfig,
  getChannelConfig,
  getChannelFormValues,
  deleteChannelConfig,
  listConfiguredChannels,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../utils/channel-config';
import { toOpenClawChannelType, toUiChannelType } from '../utils/channel-alias';
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';
import {
  ensureDingTalkPluginInstalled,
  ensureFeishuPluginInstalled,
  ensureWeComPluginInstalled,
} from '../utils/plugin-install';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../utils/skill-config';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';
import { deviceOAuthManager, OAuthProviderType } from '../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../utils/browser-oauth';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import { proxyAwareFetch } from '../utils/proxy-fetch';
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
import { registerHostApiProxyHandlers } from './ipc/host-api-proxy';
import {
  isLaunchAtStartupKey,
  isProxyKey,
  mapAppErrorCode,
  type AppRequest,
  type AppResponse,
} from './ipc/request-helpers';

const gatewayRpcBackpressure = new GatewayRpcBackpressure();

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow
): void {
  // Unified request protocol (non-breaking: legacy channels remain available)
  registerUnifiedRequestHandlers(gatewayManager);

  // Host API proxy handlers
  registerHostApiProxyHandlers();

  // Gateway handlers
  registerGatewayHandlers(gatewayManager, mainWindow);

  // ClawHub handlers
  registerClawHubHandlers(clawHubService);

  // OpenClaw handlers
  registerOpenClawHandlers(gatewayManager);

  // Provider handlers
  registerProviderHandlers(gatewayManager);

  // Shell handlers
  registerShellHandlers();

  // Dialog handlers
  registerDialogHandlers();

  // Session handlers
  registerSessionHandlers();

  // App handlers
  registerAppHandlers();

  // Settings handlers
  registerSettingsHandlers(gatewayManager);

  // UV handlers
  registerUvHandlers();

  // Log handlers (for UI to read gateway/app logs)
  registerLogHandlers();

  // Usage handlers
  registerUsageHandlers();

  // Skill config handlers (direct file access, no Gateway RPC)
  registerSkillConfigHandlers();

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager);

  // Window control handlers (for custom title bar on Windows/Linux)
  registerWindowHandlers(mainWindow);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);

  // Device OAuth handlers (Code Plan)
  registerDeviceOAuthHandlers(mainWindow);

  // File staging handlers (upload/send separation)
  registerFileHandlers();

  // File preview handlers (sandboxed read/write/list for inline viewer)
  registerFilePreviewHandlers();
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
        case 'cron': {
          if (request.action === 'list') {
            const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
            const jobs = (result as { jobs?: GatewayCronJob[] })?.jobs ?? [];
            data = jobs.map(transformCronJob);
            break;
          }
          if (request.action === 'create') {
            type CronCreateInput = {
              name: string;
              message: string;
              schedule: string;
              delivery?: { mode: string; channel?: string; to?: string };
              enabled?: boolean;
            };
            const payload = request.payload as
              | { input?: CronCreateInput }
              | [CronCreateInput]
              | CronCreateInput
              | undefined;
            let input: CronCreateInput | undefined;
            if (Array.isArray(payload)) {
              input = payload[0];
            } else if (payload && typeof payload === 'object' && 'input' in payload) {
              input = payload.input;
            } else {
              input = payload as CronCreateInput | undefined;
            }
            if (!input) throw new Error('Invalid cron.create payload');
            const gatewayInput = {
              name: input.name,
              schedule: { kind: 'cron', expr: input.schedule },
              payload: { kind: 'agentTurn', message: input.message },
              enabled: input.enabled ?? true,
              wakeMode: 'next-heartbeat',
              sessionTarget: 'isolated',
              delivery: normalizeCronDelivery(input.delivery),
            };
            const unsupportedDeliveryError = getUnsupportedCronDeliveryError(gatewayInput.delivery.channel);
            if (gatewayInput.delivery.mode === 'announce' && unsupportedDeliveryError) {
              throw new Error(unsupportedDeliveryError);
            }
            const created = await gatewayManager.rpc('cron.add', gatewayInput);
            data = created && typeof created === 'object' ? transformCronJob(created as GatewayCronJob) : created;
            break;
          }
          if (request.action === 'update') {
            const payload = request.payload as
              | { id?: string; input?: Record<string, unknown> }
              | [string, Record<string, unknown>]
              | undefined;
            const id = Array.isArray(payload) ? payload[0] : payload?.id;
            const input = Array.isArray(payload) ? payload[1] : payload?.input;
            if (!id || !input) throw new Error('Invalid cron.update payload');
            const patch = buildCronUpdatePatch(input);
            const deliveryPatch = patch.delivery && typeof patch.delivery === 'object'
              ? patch.delivery as Record<string, unknown>
              : undefined;
            const deliveryChannel = typeof deliveryPatch?.channel === 'string' && deliveryPatch.channel.trim()
              ? deliveryPatch.channel.trim()
              : undefined;
            const deliveryMode = typeof deliveryPatch?.mode === 'string' && deliveryPatch.mode.trim()
              ? deliveryPatch.mode.trim()
              : undefined;
            const unsupportedDeliveryError = getUnsupportedCronDeliveryError(deliveryChannel);
            if (unsupportedDeliveryError && deliveryMode !== 'none') {
              throw new Error(unsupportedDeliveryError);
            }
            data = await gatewayManager.rpc('cron.update', { id, patch });
            break;
          }
          if (request.action === 'delete') {
            const payload = request.payload as { id?: string } | string | undefined;
            const id = typeof payload === 'string' ? payload : payload?.id;
            if (!id) throw new Error('Invalid cron.delete payload');
            data = await gatewayManager.rpc('cron.remove', { id });
            break;
          }
          if (request.action === 'toggle') {
            const payload = request.payload as { id?: string; enabled?: boolean } | [string, boolean] | undefined;
            const id = Array.isArray(payload) ? payload[0] : payload?.id;
            const enabled = Array.isArray(payload) ? payload[1] : payload?.enabled;
            if (!id || typeof enabled !== 'boolean') throw new Error('Invalid cron.toggle payload');
            data = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
            break;
          }
          if (request.action === 'trigger') {
            const payload = request.payload as { id?: string } | string | undefined;
            const id = typeof payload === 'string' ? payload : payload?.id;
            if (!id) throw new Error('Invalid cron.trigger payload');
            data = await gatewayManager.rpc('cron.run', { id, mode: 'force' });
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
            data = { success: true };
            break;
          }
          if (request.action === 'reset') {
            await resetSettings();
            const settings = await getAllSettings();
            await handleProxySettingsChange();
            await syncLaunchAtStartupSettingFromStore();
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
 * Skill config IPC handlers
 * Direct read/write to ~/.openclaw/openclaw.json (bypasses Gateway RPC)
 */
function registerSkillConfigHandlers(): void {
  // Update skill config (apiKey and env)
  ipcMain.handle('skill:updateConfig', async (_, params: {
    skillKey: string;
    apiKey?: string;
    env?: Record<string, string>;
  }) => {
    return await updateSkillConfig(params.skillKey, {
      apiKey: params.apiKey,
      env: params.env,
    });
  });

  // Get skill config
  ipcMain.handle('skill:getConfig', async (_, skillKey: string) => {
    return await getSkillConfig(skillKey);
  });

  // Get all skill configs
  ipcMain.handle('skill:getAllConfigs', async () => {
    return await getAllSkillConfigs();
  });
}

/**
 * Gateway CronJob type (as returned by cron.list RPC)
 */
interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string; accountId?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

type GatewayCronDelivery = NonNullable<GatewayCronJob['delivery']>;

function getUnsupportedCronDeliveryError(_channel: string | undefined): string | null {
  // Channel support is gated by the frontend whitelist (TESTED_CRON_DELIVERY_CHANNELS).
  // No per-channel backend blocks are needed.
  return null;
}

function normalizeCronDelivery(
  rawDelivery: unknown,
  fallbackMode: GatewayCronDelivery['mode'] = 'none',
): GatewayCronDelivery {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return { mode: fallbackMode };
  }

  const delivery = rawDelivery as Record<string, unknown>;
  const mode = typeof delivery.mode === 'string' && delivery.mode.trim()
    ? delivery.mode.trim()
    : fallbackMode;
  const channel = typeof delivery.channel === 'string' && delivery.channel.trim()
    ? toOpenClawChannelType(delivery.channel.trim())
    : undefined;
  const to = typeof delivery.to === 'string' && delivery.to.trim()
    ? delivery.to.trim()
    : undefined;
  const accountId = typeof delivery.accountId === 'string' && delivery.accountId.trim()
    ? delivery.accountId.trim()
    : undefined;

  if (mode === 'announce' && !channel) {
    return { mode: 'none' };
  }

  return {
    mode,
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function normalizeCronDeliveryPatch(rawDelivery: unknown): Record<string, unknown> {
  if (!rawDelivery || typeof rawDelivery !== 'object') {
    return {};
  }

  const delivery = rawDelivery as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ('mode' in delivery) {
    patch.mode = typeof delivery.mode === 'string' && delivery.mode.trim()
      ? delivery.mode.trim()
      : 'none';
  }
  if ('channel' in delivery) {
    patch.channel = typeof delivery.channel === 'string' && delivery.channel.trim()
      ? toOpenClawChannelType(delivery.channel.trim())
      : '';
  }
  if ('to' in delivery) {
    patch.to = typeof delivery.to === 'string' ? delivery.to : '';
  }
  if ('accountId' in delivery) {
    patch.accountId = typeof delivery.accountId === 'string' ? delivery.accountId : '';
  }
  return patch;
}

function buildCronUpdatePatch(input: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...input };

  if (typeof patch.schedule === 'string') {
    patch.schedule = { kind: 'cron', expr: patch.schedule };
  }

  if (typeof patch.message === 'string') {
    patch.payload = { kind: 'agentTurn', message: patch.message };
    delete patch.message;
  }

  if ('delivery' in patch) {
    patch.delivery = normalizeCronDeliveryPatch(patch.delivery);
  }

  return patch;
}

/**
 * Transform a Gateway CronJob to the frontend CronJob format
 */
function transformCronJob(job: GatewayCronJob) {
  // Extract message from payload
  const message = job.payload?.message || job.payload?.text || '';
  const gatewayDelivery = normalizeCronDelivery(job.delivery);
  const channelType = gatewayDelivery.channel ? toUiChannelType(gatewayDelivery.channel) : undefined;
  const delivery = channelType
    ? { ...gatewayDelivery, channel: channelType }
    : gatewayDelivery;

  // Build target from delivery info — only if a delivery channel is specified
  const target = channelType
    ? { channelType, channelId: delivery.accountId || gatewayDelivery.channel, channelName: channelType, recipient: delivery.to }
    : undefined;

  // Build lastRun from state
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;

  // Build nextRun from state
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule, // Pass the object through; frontend parseCronSchedule handles it
    delivery,
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

/**
 * Cron task IPC handlers
 * Proxies cron operations to the Gateway RPC service.
 * The frontend works with plain cron expression strings, but the Gateway
 * expects CronSchedule objects ({ kind: "cron", expr: "..." }).
 * These handlers bridge the two formats.
 */
function registerCronHandlers(gatewayManager: GatewayManager): void {
  // List all cron jobs — transforms Gateway CronJob format to frontend CronJob format
  ipcMain.handle('cron:list', async () => {
    try {
      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const jobs = Array.isArray(result) ? result : (result as { jobs?: GatewayCronJob[] })?.jobs ?? [];

      // Auto-repair legacy UI-created jobs that were saved without
      // delivery: { mode: 'none' }.  The Gateway auto-normalizes them
      // to delivery: { mode: 'announce' } which then fails with
      // "Channel is required" when no external channels are configured.
      for (const job of jobs) {
        const isIsolatedAgent =
          (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
          job.payload?.kind === 'agentTurn';
        const needsRepair =
          isIsolatedAgent &&
          job.delivery?.mode === 'announce' &&
          !job.delivery?.channel;

        if (needsRepair) {
          try {
            await gatewayManager.rpc('cron.update', {
              id: job.id,
              patch: { delivery: { mode: 'none' } },
            });
            job.delivery = { mode: 'none' };
            // Clear stale channel-resolution error from the last run
            if (job.state?.lastError?.includes('Channel is required')) {
              job.state.lastError = undefined;
              job.state.lastStatus = 'ok';
            }
          } catch (e) {
            console.warn(`Failed to auto-repair cron job ${job.id}:`, e);
          }
        }
      }

      // Transform Gateway format to frontend format
      return jobs.map(transformCronJob);
    } catch (error) {
      console.error('Failed to list cron jobs:', error);
      throw error;
    }
  });

  // Create a new cron job
  // UI-created tasks have no delivery target — results go to the ClawX chat page.
  // Tasks created via external channels (Feishu, Discord, etc.) are handled
  // directly by the OpenClaw Gateway and do not pass through this IPC handler.
  ipcMain.handle('cron:create', async (_, input: {
    name: string;
    message: string;
    schedule: string;
    delivery?: GatewayCronDelivery;
    enabled?: boolean;
  }) => {
    try {
      const gatewayInput = {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message: input.message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        // UI-created jobs deliver results via ClawX WebSocket chat events,
        // not external messaging channels.  Setting mode='none' prevents
        // the Gateway from attempting channel delivery (which would fail
        // with "Channel is required" when no channels are configured).
        delivery: normalizeCronDelivery(input.delivery),
      };
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(gatewayInput.delivery.channel);
      if (gatewayInput.delivery.mode === 'announce' && unsupportedDeliveryError) {
        throw new Error(unsupportedDeliveryError);
      }
      const result = await gatewayManager.rpc('cron.add', gatewayInput);
      // Transform the returned job to frontend format
      if (result && typeof result === 'object') {
        return transformCronJob(result as GatewayCronJob);
      }
      return result;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  });

  // Update an existing cron job
  ipcMain.handle('cron:update', async (_, id: string, input: Record<string, unknown>) => {
    try {
      const patch = buildCronUpdatePatch(input);
      const deliveryPatch = patch.delivery && typeof patch.delivery === 'object'
        ? patch.delivery as Record<string, unknown>
        : undefined;
      const deliveryChannel = typeof deliveryPatch?.channel === 'string' && deliveryPatch.channel.trim()
        ? deliveryPatch.channel.trim()
        : undefined;
      const deliveryMode = typeof deliveryPatch?.mode === 'string' && deliveryPatch.mode.trim()
        ? deliveryPatch.mode.trim()
        : undefined;
      const unsupportedDeliveryError = getUnsupportedCronDeliveryError(deliveryChannel);
      if (unsupportedDeliveryError && deliveryMode !== 'none') {
        throw new Error(unsupportedDeliveryError);
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      return result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result;
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  });

  // Delete a cron job
  ipcMain.handle('cron:delete', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.remove', { id });
      return result;
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  });

  // Toggle a cron job enabled/disabled
  ipcMain.handle('cron:toggle', async (_, id: string, enabled: boolean) => {
    try {
      const result = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
      return result;
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  });

  // Trigger a cron job manually
  ipcMain.handle('cron:trigger', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.run', { id, mode: 'force' });
      return result;
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  });

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
 * UV-related IPC handlers
 */
function registerUvHandlers(): void {
  // Check if uv is installed
  ipcMain.handle('uv:check', async () => {
    return await checkUvInstalled();
  });

  // Install uv and setup managed Python
  ipcMain.handle('uv:install-all', async () => {
    try {
      const isInstalled = await checkUvInstalled();
      if (!isInstalled) {
        await installUv();
      }
      // Always run python setup to ensure it exists in uv's cache
      await setupManagedPython();
      return { success: true };
    } catch (error) {
      console.error('Failed to setup uv/python:', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Log-related IPC handlers
 * Allows the renderer to read application logs for diagnostics
 */
function registerLogHandlers(): void {
  // Get recent logs from memory ring buffer
  ipcMain.handle('log:getRecent', async (_, count?: number) => {
    return logger.getRecentLogs(count);
  });

  // Read log file content (last N lines)
  ipcMain.handle('log:readFile', async (_, tailLines?: number) => {
    return await logger.readLogFile(tailLines);
  });

  // Get log file path (so user can open in file explorer)
  ipcMain.handle('log:getFilePath', async () => {
    return logger.getLogFilePath();
  });

  // Get log directory path
  ipcMain.handle('log:getDir', async () => {
    return logger.getLogDir();
  });

  // List all log files
  ipcMain.handle('log:listFiles', async () => {
    return await logger.listLogFiles();
  });
}

/**
 * Gateway-related IPC handlers
 */
function registerGatewayHandlers(
  gatewayManager: GatewayManager,
  mainWindow: BrowserWindow
): void {
  type GatewayHttpProxyRequest = {
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  };

  // Get Gateway status
  ipcMain.handle('gateway:status', () => {
    return gatewayManager.getStatus();
  });

  // Check if Gateway is connected
  ipcMain.handle('gateway:isConnected', () => {
    return gatewayManager.isConnected();
  });

  // Start Gateway
  ipcMain.handle('gateway:start', async () => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop Gateway
  ipcMain.handle('gateway:stop', async () => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Restart Gateway
  ipcMain.handle('gateway:restart', async () => {
    try {
      await gatewayManager.restart();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
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

  // Gateway HTTP proxy
  // Renderer must not call gateway HTTP directly (CORS); all HTTP traffic
  // should go through this main-process proxy.
  ipcMain.handle('gateway:httpProxy', async (_, request: GatewayHttpProxyRequest) => {
    try {
      const status = gatewayManager.getStatus();
      const port = status.port || 18789;
      const path = request?.path && request.path.startsWith('/') ? request.path : '/';
      const method = (request?.method || 'GET').toUpperCase();
      const timeoutMs =
        typeof request?.timeoutMs === 'number' && request.timeoutMs > 0
          ? request.timeoutMs
          : 15000;

      const token = await getSetting('gatewayToken');
      const headers: Record<string, string> = {
        ...(request?.headers ?? {}),
      };
      if (!headers.Authorization && !headers.authorization && token) {
        headers.Authorization = `Bearer ${token}`;
      }

      let body: string | undefined;
      if (request?.body !== undefined && request?.body !== null) {
        body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await (async () => {
        try {
          return await proxyAwareFetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers,
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      })();

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const json = await response.json();
        return {
          success: true,
          status: response.status,
          ok: response.ok,
          json,
        };
      }

      const text = await response.text();
      return {
        success: true,
        status: response.status,
        ok: response.ok,
        text,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  });

  // Chat send with media — reads staged files from disk and builds attachments.
  // Raster images (png/jpg/gif/webp) are inlined as base64 vision attachments.
  // All other files are referenced by path in the message text so the model
  // can access them via tools (the same format channels use).
  const VISION_MIME_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/bmp', 'image/webp',
  ]);

  ipcMain.handle('chat:sendWithMedia', async (_, params: {
    sessionKey: string;
    message: string;
    deliver?: boolean;
    idempotencyKey: string;
    media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
  }) => {
    try {
      let message = params.message;
      // The Gateway processes image attachments through TWO parallel paths:
      // Path A: `attachments` param → parsed via `parseMessageWithAttachments` →
      //   injected as inline vision content when the model supports images.
      //   Format: { content: base64, mimeType: string, fileName?: string }
      // Path B: `[media attached: ...]` in message text → Gateway's native image
      //   detection (`detectAndLoadPromptImages`) reads the file from disk and
      //   injects it as inline vision content. Also works for history messages.
      // We use BOTH paths for maximum reliability.
      const imageAttachments: Array<Record<string, unknown>> = [];
      const fileReferences: string[] = [];

      if (params.media && params.media.length > 0) {
        const fsP = await import('fs/promises');
        for (const m of params.media) {
          const exists = await fsP.access(m.filePath).then(() => true, () => false);
          logger.info(`[chat:sendWithMedia] Processing file: ${m.fileName} (${m.mimeType}), path: ${m.filePath}, exists: ${exists}, isVision: ${VISION_MIME_TYPES.has(m.mimeType)}`);

          // Always add file path reference so the model can access it via tools
          fileReferences.push(
            `[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`,
          );

          if (VISION_MIME_TYPES.has(m.mimeType)) {
            // Send as base64 attachment in the format the Gateway expects:
            // { content: base64String, mimeType: string, fileName?: string }
            // The Gateway normalizer looks for `a.content` (NOT `a.source.data`).
            const fileBuffer = await fsP.readFile(m.filePath);
            const base64Data = fileBuffer.toString('base64');
            logger.info(`[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`);
            imageAttachments.push({
              content: base64Data,
              mimeType: m.mimeType,
              fileName: m.fileName,
            });
          }
        }
      }

      // Append file references to message text so the model knows about them
      if (fileReferences.length > 0) {
        const refs = fileReferences.join('\n');
        message = message ? `${message}\n\n${refs}` : refs;
      }

      const rpcParams: Record<string, unknown> = {
        sessionKey: params.sessionKey,
        message,
        deliver: params.deliver ?? false,
        idempotencyKey: params.idempotencyKey,
      };

      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }

      logger.info(`[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`);

      // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
      const timeoutMs = 120000;
      const result = await gatewayManager.rpc('chat.send', rpcParams, timeoutMs);
      logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
      return { success: true, result };
    } catch (error) {
      logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
      return { success: false, error: String(error) };
    }
  });

  // Get the Control UI URL with token for embedding
  ipcMain.handle('gateway:getControlUiUrl', async () => {
    try {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || 18789;
      const url = buildOpenClawControlUiUrl(port, token);
      return { success: true, url, port, token };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Health check
  ipcMain.handle('gateway:health', async () => {
    try {
      const health = await gatewayManager.checkHealth();
      return { success: true, ...health };
    } catch (error) {
      return { success: false, ok: false, error: String(error) };
    }
  });

  // Forward Gateway events to renderer
  gatewayManager.on('status', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:status-changed', status);
    }
  });

  gatewayManager.on('message', (message) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:message', message);
    }
  });

  gatewayManager.on('notification', (notification) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:notification', notification);
    }
  });

  gatewayManager.on('gateway:health', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:health-changed', data);
    }
  });

  gatewayManager.on('gateway:presence', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:presence-changed', data);
    }
  });

  gatewayManager.on('channel:status', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:channel-status', data);
    }
  });

  gatewayManager.on('chat:message', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:chat-message', data);
    }
  });

  gatewayManager.on('exit', (code) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:exit', code);
    }
  });

  gatewayManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:error', error.message);
    }
  });
}

/**
 * OpenClaw-related IPC handlers
 * For checking package status and channel configuration
 */
function registerOpenClawHandlers(gatewayManager: GatewayManager): void {
  // Plugin-based channels require a full Gateway process restart to properly
  // initialize / tear-down plugin connections.  SIGUSR1 in-process reload is
  // not sufficient for channel plugins (see restartGatewayForAgentDeletion).
  const forceRestartChannels = new Set(['dingtalk', 'wecom', 'whatsapp', 'feishu', 'qqbot']);

  const scheduleGatewayChannelRestart = (reason: string): void => {
    if (gatewayManager.getStatus().state !== 'stopped') {
      logger.info(`Scheduling Gateway restart after ${reason}`);
      gatewayManager.debouncedRestart(150);
    } else {
      logger.info(`Gateway is stopped; skip immediate restart after ${reason}`);
    }
  };

  const scheduleGatewayChannelSaveRefresh = (channelType: string, reason: string): void => {
    if (gatewayManager.getStatus().state === 'stopped') {
      logger.info(`Gateway is stopped; skip immediate refresh after ${reason}`);
      return;
    }
    if (forceRestartChannels.has(channelType)) {
      logger.info(`Scheduling Gateway restart after ${reason}`);
      gatewayManager.debouncedRestart(150);
      return;
    }
    logger.info(`Scheduling Gateway reload after ${reason}`);
    gatewayManager.debouncedReload(150);
  };

  // Get OpenClaw package status
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  // Check if OpenClaw is ready (package present)
  ipcMain.handle('openclaw:isReady', () => {
    const status = getOpenClawStatus();
    return status.packageExists;
  });

  // Get the resolved OpenClaw directory path (for diagnostics)
  ipcMain.handle('openclaw:getDir', () => {
    return getOpenClawDir();
  });

  // Get the OpenClaw config directory (~/.openclaw)
  ipcMain.handle('openclaw:getConfigDir', () => {
    return getOpenClawConfigDir();
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


  // ==================== Channel Configuration Handlers ====================

  // Save channel configuration
  ipcMain.handle('channel:saveConfig', async (_, channelType: string, config: Record<string, unknown>) => {
    try {
      logger.info('channel:saveConfig', { channelType, keys: Object.keys(config || {}) });
      if (channelType === 'dingtalk') {
        const installResult = await ensureDingTalkPluginInstalled();
        if (!installResult.installed) {
          return {
            success: false,
            error: installResult.warning || 'DingTalk plugin install failed',
          };
        }
        await saveChannelConfig(channelType, config);
        scheduleGatewayChannelSaveRefresh(channelType, `channel:saveConfig (${channelType})`);
        return {
          success: true,
          pluginInstalled: installResult.installed,
          warning: installResult.warning,
        };
      }
      if (channelType === 'wecom') {
        const installResult = await ensureWeComPluginInstalled();
        if (!installResult.installed) {
          return {
            success: false,
            error: installResult.warning || 'WeCom plugin install failed',
          };
        }
        await saveChannelConfig(channelType, config);
        scheduleGatewayChannelSaveRefresh(channelType, `channel:saveConfig (${channelType})`);
        return {
          success: true,
          pluginInstalled: installResult.installed,
          warning: installResult.warning,
        };
      }
      // QQBot is a built-in channel since OpenClaw 3.31 — no plugin install needed
      if (channelType === 'feishu') {
        const installResult = await ensureFeishuPluginInstalled();
        if (!installResult.installed) {
          return {
            success: false,
            error: installResult.warning || 'Feishu plugin install failed',
          };
        }
        await saveChannelConfig(channelType, config);
        scheduleGatewayChannelSaveRefresh(channelType, `channel:saveConfig (${channelType})`);
        return {
          success: true,
          pluginInstalled: installResult.installed,
          warning: installResult.warning,
        };
      }
      await saveChannelConfig(channelType, config);
      scheduleGatewayChannelSaveRefresh(channelType, `channel:saveConfig (${channelType})`);
      return { success: true };
    } catch (error) {
      console.error('Failed to save channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get channel configuration
  ipcMain.handle('channel:getConfig', async (_, channelType: string) => {
    try {
      const config = await getChannelConfig(channelType);
      return { success: true, config };
    } catch (error) {
      console.error('Failed to get channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get channel form values (reverse-transformed for UI pre-fill)
  ipcMain.handle('channel:getFormValues', async (_, channelType: string) => {
    try {
      const values = await getChannelFormValues(channelType);
      return { success: true, values };
    } catch (error) {
      console.error('Failed to get channel form values:', error);
      return { success: false, error: String(error) };
    }
  });

  // Delete channel configuration
  ipcMain.handle('channel:deleteConfig', async (_, channelType: string) => {
    try {
      await deleteChannelConfig(channelType);
      scheduleGatewayChannelRestart(`channel:deleteConfig (${channelType})`);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // List configured channels
  ipcMain.handle('channel:listConfigured', async () => {
    try {
      const channels = await listConfiguredChannels();
      return { success: true, channels };
    } catch (error) {
      console.error('Failed to list channels:', error);
      return { success: false, error: String(error) };
    }
  });

  // Enable or disable a channel
  ipcMain.handle('channel:setEnabled', async (_, channelType: string, enabled: boolean) => {
    try {
      await setChannelEnabled(channelType, enabled);
      scheduleGatewayChannelRestart(`channel:setEnabled (${channelType}, enabled=${enabled})`);
      return { success: true };
    } catch (error) {
      console.error('Failed to set channel enabled:', error);
      return { success: false, error: String(error) };
    }
  });

  // Validate channel configuration
  ipcMain.handle('channel:validate', async (_, channelType: string) => {
    try {
      const result = await validateChannelConfig(channelType);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to validate channel:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });

  // Validate channel credentials by calling actual service APIs (before saving)
  ipcMain.handle('channel:validateCredentials', async (_, channelType: string, config: Record<string, string>) => {
    try {
      const result = await validateChannelCredentials(channelType, config);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to validate channel credentials:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });
}

/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Request WhatsApp QR code
  ipcMain.handle('channel:requestWhatsAppQr', async (_, accountId: string) => {
    try {
      logger.info('channel:requestWhatsAppQr', { accountId });
      await whatsAppLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      logger.error('channel:requestWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Cancel WhatsApp login
  ipcMain.handle('channel:cancelWhatsAppQr', async () => {
    try {
      await whatsAppLoginManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('channel:cancelWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Check WhatsApp status (is it active?)
  // ipcMain.handle('channel:checkWhatsAppStatus', ...)

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
 * Device OAuth Handlers (Code Plan)
 */
function registerDeviceOAuthHandlers(mainWindow: BrowserWindow): void {
  deviceOAuthManager.setWindow(mainWindow);
  browserOAuthManager.setWindow(mainWindow);

  // Request Provider OAuth initialization
  ipcMain.handle(
    'provider:requestOAuth',
    async (
      _,
      provider: OAuthProviderType | BrowserOAuthProviderType,
      region?: 'global' | 'cn',
      options?: { accountId?: string; label?: string },
    ) => {
      try {
        logger.info(`provider:requestOAuth for ${provider}`);
        if (provider === 'google' || provider === 'openai') {
          await browserOAuthManager.startFlow(provider, options);
        } else {
          await deviceOAuthManager.startFlow(provider, region, options);
        }
        return { success: true };
      } catch (error) {
        logger.error('provider:requestOAuth failed', error);
        return { success: false, error: String(error) };
      }
    },
  );

  // Cancel Provider OAuth
  ipcMain.handle('provider:cancelOAuth', async () => {
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      return { success: true };
    } catch (error) {
      logger.error('provider:cancelOAuth failed', error);
      return { success: false, error: String(error) };
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

  // New provider-service endpoints used by the account-based refactor.
  ipcMain.handle('provider:listVendors', async () => {
    return await providerService.listVendors();
  });

  ipcMain.handle('provider:listAccounts', async () => {
    return await providerService.listAccounts();
  });

  ipcMain.handle('provider:getAccount', async (_, accountId: string) => {
    return await providerService.getAccount(accountId);
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
 * ClawHub-related IPC handlers
 */
function registerClawHubHandlers(clawHubService: ClawHubService): void {
  // Search skills
  ipcMain.handle('clawhub:search', async (_, params: ClawHubSearchParams) => {
    try {
      const results = await clawHubService.search(params);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Install skill
  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Uninstall skill
  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // List installed skills
  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Open skill readme
  ipcMain.handle('clawhub:openSkillReadme', async (_, slug: string) => {
    try {
      await clawHubService.openSkillReadme(slug);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
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

  // Show save dialog
  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
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

  // Get app path
  ipcMain.handle('app:getPath', (_, name: Parameters<typeof app.getPath>[0]) => {
    return app.getPath(name);
  });

  // Get platform
  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  // Quit app
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // Relaunch app
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
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

    return { success: true };
  });

  ipcMain.handle('settings:reset', async () => {
    await resetSettings();
    const settings = await getAllSettings();
    await handleProxySettingsChange();
    await syncLaunchAtStartupSettingFromStore();
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

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');

/**
 * Generate a preview data URL for image files.
 * Resizes large images while preserving aspect ratio (only constrain the
 * longer side so the image is never squished). The frontend handles
 * square cropping via CSS object-fit: cover.
 */
async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512; // keep enough resolution for crisp display on Retina
    // Only resize if larger than threshold — specify ONE dimension to keep ratio
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })   // landscape / square → constrain width
        : img.resize({ height: maxDim }); // portrait → constrain height
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    // Small image — use original (async read to avoid blocking)
    const { readFile: readFileAsync } = await import('fs/promises');
    const buf = await readFileAsync(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * File staging IPC handlers
 * Stage files to ~/.openclaw/media/outbound/ for gateway access
 */
function registerFileHandlers(): void {
  // Stage files from real disk paths (used with dialog:open)
  ipcMain.handle('file:stage', async (_, filePaths: string[]) => {
    const fsP = await import('fs/promises');
    await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

    const results = [];
    for (const filePath of filePaths) {
      const id = crypto.randomUUID();
      const ext = extname(filePath);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      await fsP.copyFile(filePath, stagedPath);

      const s = await fsP.stat(stagedPath);
      const mimeType = getMimeType(ext);
      const fileName = basename(filePath);

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = await generateImagePreview(stagedPath, mimeType);
      }

      results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
    }
    return results;
  });

  // Stage file from buffer (used for clipboard paste / drag-drop)
  ipcMain.handle('file:stageBuffer', async (_, payload: {
    base64: string;
    fileName: string;
    mimeType: string;
  }) => {
    const fsP = await import('fs/promises');
    await fsP.mkdir(OUTBOUND_DIR, { recursive: true });

    const id = crypto.randomUUID();
    const ext = extname(payload.fileName) || mimeToExt(payload.mimeType);
    const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
    const buffer = Buffer.from(payload.base64, 'base64');
    await fsP.writeFile(stagedPath, buffer);

    const mimeType = payload.mimeType || getMimeType(ext);
    const fileSize = buffer.length;

    // Generate preview for images
    let preview: string | null = null;
    if (mimeType.startsWith('image/')) {
      preview = await generateImagePreview(stagedPath, mimeType);
    }

    return { id, fileName: payload.fileName, mimeType, fileSize, stagedPath, preview };
  });

  // Load thumbnails for file paths on disk (used to restore previews in history)
  // Save an image to a user-chosen location (base64 data URI or existing file path)
  ipcMain.handle('media:saveImage', async (_, params: {
    base64?: string;
    mimeType?: string;
    filePath?: string;
    defaultFileName: string;
  }) => {
    try {
      const ext = params.defaultFileName.includes('.')
        ? params.defaultFileName.split('.').pop()!
        : (params.mimeType?.split('/')[1] || 'png');
      const result = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Downloads', params.defaultFileName),
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return { success: false };

      const fsP = await import('fs/promises');
      if (params.filePath) {
        try {
          await fsP.access(params.filePath);
          await fsP.copyFile(params.filePath, result.filePath);
        } catch {
          return { success: false, error: 'Source file not found' };
        }
      } else if (params.base64) {
        const buffer = Buffer.from(params.base64, 'base64');
        await fsP.writeFile(result.filePath, buffer);
      } else {
        return { success: false, error: 'No image data provided' };
      }
      return { success: true, savedPath: result.filePath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('media:getThumbnails', async (
    _,
    paths: Array<{ filePath?: string; gatewayUrl?: string; mimeType: string }>,
  ) => {
    const fsP = await import('fs/promises');
    const results: Record<string, { preview: string | null; fileSize: number }> = {};
    for (const entry of paths) {
      // Local on-disk file (the original code path).
      if (entry.filePath) {
        try {
          const s = await fsP.stat(entry.filePath);
          let preview: string | null = null;
          if (entry.mimeType.startsWith('image/')) {
            preview = await generateImagePreview(entry.filePath, entry.mimeType);
          }
          results[entry.filePath] = { preview, fileSize: s.size };
        } catch {
          results[entry.filePath] = { preview: null, fileSize: 0 };
        }
        continue;
      }
      // Gateway-injected outgoing media URL. The renderer cannot reach the
      // Gateway HTTP server directly (CORS / env drift), so we resolve it
      // here against OpenClaw's local outgoing media records and load the
      // original file off disk. The URL shape is fixed by OpenClaw:
      //   /api/chat/media/outgoing/<urlEncodedSessionKey>/<attachmentId>/full
      if (entry.gatewayUrl) {
        const resolved = await resolveOutgoingMediaUrl(entry.gatewayUrl);
        if (!resolved) {
          results[entry.gatewayUrl] = { preview: null, fileSize: 0 };
          continue;
        }
        try {
          const s = await fsP.stat(resolved.path);
          let preview: string | null = null;
          if (resolved.mimeType.startsWith('image/')) {
            preview = await generateImagePreview(resolved.path, resolved.mimeType);
          }
          results[entry.gatewayUrl] = { preview, fileSize: s.size };
        } catch {
          results[entry.gatewayUrl] = { preview: null, fileSize: 0 };
        }
      }
    }
    return results;
  });
}

/**
 * Resolve a Gateway-emitted outgoing-media URL to the original file on disk.
 *
 * OpenClaw's runtime stages every assistant `MEDIA:/path` artifact under
 * `~/.openclaw/media/outgoing/`:
 *   - `originals/<uuid>.<ext>`   — the source bytes copied verbatim
 *   - `records/<attachmentId>.json` — `{ original: { path, contentType, ... }, ... }`
 *
 * The Gateway then injects an `assistant-media` content block with
 * `url:'/api/chat/media/outgoing/<urlEncodedSessionKey>/<attachmentId>/full'`.
 * We only need the `<attachmentId>` segment to look up the record.
 */
async function resolveOutgoingMediaUrl(
  gatewayUrl: string,
): Promise<{ path: string; mimeType: string } | null> {
  try {
    const m = gatewayUrl.match(/\/api\/chat\/media\/outgoing\/[^/]+\/([^/]+)\//);
    if (!m) return null;
    const attachmentId = decodeURIComponent(m[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(attachmentId)) return null;
    const recordPath = join(homedir(), '.openclaw', 'media', 'outgoing', 'records', `${attachmentId}.json`);
    const fsP = await import('fs/promises');
    const raw = await fsP.readFile(recordPath, 'utf8');
    const record = JSON.parse(raw) as {
      original?: { path?: string; contentType?: string };
    };
    const original = record?.original;
    if (!original?.path) return null;
    return {
      path: original.path,
      mimeType: typeof original.contentType === 'string' && original.contentType
        ? original.contentType
        : 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

/**
 * Session IPC handlers
 *
 * Performs a HARD delete of a session's JSONL transcript on disk.
 * sessionKey format: "agent:<agentId>:<suffix>" — e.g. "agent:main:session-1234567890".
 * The JSONL file lives at: ~/.openclaw/agents/<agentId>/sessions/<id>.jsonl
 * (where <id> is typically a UUID resolved via sessions.json).
 *
 * For each deleted session we unlink every file that belongs to its on-disk id:
 *   - <id>.jsonl                — the live transcript
 *   - <id>.deleted.jsonl        — leftovers from earlier soft-delete releases
 *   - <id>.jsonl.reset.*        — historical snapshots produced by sessions.reset
 *   - <id>.trajectory.jsonl     — OpenClaw runtime "flight recorder" sidecar
 *   - <id>.trajectory-path.json — pointer to the runtime trajectory; if it
 *                                 points outside the sessions/ folder
 *                                 (OPENCLAW_TRAJECTORY_DIR override) the
 *                                 referenced file is unlinked too.
 *
 * The session entry is also removed from sessions.json so sessions.list stops
 * surfacing it. Token-usage history reported by the Dashboard reads the same
 * transcripts, so deleted conversations stop contributing to the chart.
 *
 * Path resolution and the sibling sweep are shared with the HTTP mirror at
 * `electron/api/routes/sessions.ts` via `electron/utils/session-files.ts`,
 * so both surfaces unlink the same set of files for a given session id.
 */
const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function registerSessionHandlers(): void {
  ipcMain.handle('session:delete', async (_, sessionKey: string) => {
    try {
      if (!sessionKey || !sessionKey.startsWith('agent:')) {
        return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
      }

      const parts = sessionKey.split(':');
      if (parts.length < 3) {
        return { success: false, error: `sessionKey has too few parts: ${sessionKey}` };
      }

      const agentId = parts[1];
      // Defence-in-depth: agentId becomes a path segment under
      // ~/.openclaw/agents/.  Reject anything that could escape that root
      // (".." segments, slashes, NULs, etc.) before touching the FS.
      if (!SAFE_AGENT_ID.test(agentId)) {
        return { success: false, error: `Invalid agentId: ${agentId}` };
      }

      const openclawConfigDir = getOpenClawConfigDir();
      const sessionsDir = join(openclawConfigDir, 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');

      logger.info(`[session:delete] key=${sessionKey} agentId=${agentId}`);
      logger.info(`[session:delete] sessionsJson=${sessionsJsonPath}`);

      const fsP = await import('fs/promises');

      // ── Step 1: read sessions.json to find the UUID file for this sessionKey ──
      let sessionsJson: Record<string, unknown> = {};
      try {
        const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
        sessionsJson = JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        logger.warn(`[session:delete] Could not read sessions.json: ${String(e)}`);
        return { success: false, error: `Could not read sessions.json: ${String(e)}` };
      }

      const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
      if (!resolution.ok) {
        if (resolution.failure.kind === 'not-found') {
          const rawVal = sessionsJson[sessionKey];
          logger.warn(`[session:delete] Cannot resolve file for "${sessionKey}". Raw value: ${JSON.stringify(rawVal)}`);
          return { success: false, error: `Cannot resolve file for session: ${sessionKey}` };
        }
        logger.warn(`[session:delete] Refusing to delete out-of-scope path for "${sessionKey}": ${resolution.failure.resolvedPath}`);
        return { success: false, error: `Resolved session path is outside the agent sessions dir: ${resolution.failure.resolvedPath}` };
      }

      const { resolvedSrcPath, sessionsDirAbs, baseId } = resolution;
      logger.info(`[session:delete] file: ${resolvedSrcPath}`);

      // ── Step 2: hard-delete the JSONL transcript and its siblings ──
      const sweep = await sweepSessionArtefacts(sessionsDirAbs, baseId);
      for (const removedPath of sweep.removed) {
        logger.info(`[session:delete] Unlinked ${removedPath}`);
      }
      for (const { path: failedPath, error } of sweep.errors) {
        logger.warn(`[session:delete] Failed to unlink ${failedPath}: ${String(error)}`);
      }
      logger.info(`[session:delete] Hard-deleted ${sweep.removed.length} file(s) for ${baseId}`);

      // ── Step 3: remove the entry from sessions.json ──
      try {
        // Re-read to avoid race conditions
        const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
        const json2 = JSON.parse(raw2) as Record<string, unknown>;
        removeSessionEntry(json2, sessionKey);
        await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
        logger.info(`[session:delete] Removed "${sessionKey}" from sessions.json`);
      } catch (e) {
        logger.warn(`[session:delete] Could not update sessions.json: ${String(e)}`);
        // Non-fatal — transcript files were already unlinked.
      }

      return { success: true };
    } catch (err) {
      logger.error(`[session:delete] Unexpected error for ${sessionKey}:`, err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('session:rename', async (_, sessionKey: string, label: string) => {
    try {
      if (!sessionKey || !sessionKey.startsWith('agent:')) {
        return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
      }
      if (!label || typeof label !== 'string' || !label.trim()) {
        return { success: false, error: 'Label cannot be empty' };
      }

      const parts = sessionKey.split(':');
      if (parts.length < 3) {
        return { success: false, error: `Malformed sessionKey: ${sessionKey}` };
      }
      const agentId = parts[1];
      if (!SAFE_AGENT_ID.test(agentId)) {
        return { success: false, error: `Invalid agentId in sessionKey: ${agentId}` };
      }

      const sessionsJsonPath = join(
        getOpenClawConfigDir(),
        'agents',
        agentId,
        'sessions',
        'sessions.json',
      );

      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json = JSON.parse(raw) as Record<string, unknown>;

      // Update label in sessions.json — supports both object-keyed and array formats
      let found = false;
      if (json[sessionKey] && typeof json[sessionKey] === 'object') {
        (json[sessionKey] as Record<string, unknown>).label = label.trim();
        found = true;
      }
      if (Array.isArray(json.sessions)) {
        for (const entry of json.sessions as Array<Record<string, unknown>>) {
          if (entry.key === sessionKey || entry.sessionKey === sessionKey) {
            entry.label = label.trim();
            found = true;
          }
        }
      }

      if (!found) {
        return { success: false, error: `Session not found in sessions.json: ${sessionKey}` };
      }

      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json, null, 2), 'utf8');
      logger.info(`[session:rename] key=${sessionKey} label=${label.trim()}`);
      return { success: true };
    } catch (err) {
      logger.error(`[session:rename] Unexpected error for ${sessionKey}:`, err);
      return { success: false, error: String(err) };
    }
  });
}

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

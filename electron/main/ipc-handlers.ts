/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app, nativeImage } from 'electron';
import { existsSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';
import crypto from 'node:crypto';
import { GatewayManager } from '../gateway/manager';
import { ClawHubService, ClawHubSearchParams, ClawHubInstallParams, ClawHubUninstallParams } from '../gateway/clawhub';
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  saveProvider,
  getProvider,
  deleteProvider,
  setDefaultProvider,
  getDefaultProvider,
  getAllProvidersWithKeyInfo,
  type ProviderConfig,
} from '../utils/secure-storage';
import { getOpenClawStatus, getOpenClawDir, getOpenClawConfigDir, getOpenClawSkillsDir, ensureDir } from '../utils/paths';
import { getOpenClawCliCommand } from '../utils/openclaw-cli';
import { getSetting } from '../utils/store';
import {
  saveProviderKeyToOpenClaw,
  removeProviderFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
} from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
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
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../utils/skill-config';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';
import { deviceOAuthManager, OAuthProviderType } from '../utils/device-oauth';

/**
 * For custom/ollama providers, derive a unique key for OpenClaw config files
 * so that multiple instances of the same type don't overwrite each other.
 * For all other providers the key is simply the provider type.
 *
 * @param type - Provider type (e.g. 'custom', 'ollama', 'openrouter')
 * @param providerId - Unique provider ID from secure-storage (UUID-like)
 * @returns A string like 'custom-a1b2c3d4' or 'openrouter'
 */
export function getOpenClawProviderKey(type: string, providerId: string): string {
  if (type === 'custom' || type === 'ollama') {
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }
  if (type === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return type;
}

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow
): void {
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

  // App handlers
  registerAppHandlers();

  // UV handlers
  registerUvHandlers();

  // Log handlers (for UI to read gateway/app logs)
  registerLogHandlers();

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
  delivery?: { mode: string; channel?: string; to?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

/**
 * Transform a Gateway CronJob to the frontend CronJob format
 */
function transformCronJob(job: GatewayCronJob) {
  // Extract message from payload
  const message = job.payload?.message || job.payload?.text || '';

  // Build target from delivery info — only if a delivery channel is specified
  const channelType = job.delivery?.channel;
  const target = channelType
    ? { channelType, channelId: channelType, channelName: channelType }
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
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];

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
        delivery: { mode: 'none' },
      };
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
      // Transform schedule string to CronSchedule object if present
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      // Transform message to payload format if present
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      const result = await gatewayManager.rpc('cron.update', { id, patch });
      return result;
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
      const result = await gatewayManager.rpc(method, params, timeoutMs);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
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

      // Use a longer timeout when images are present (120s vs default 30s)
      const timeoutMs = imageAttachments.length > 0 ? 120000 : 30000;
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
      // Pass token as query param - Control UI will store it in localStorage
      const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
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
  async function ensureDingTalkPluginInstalled(): Promise<{ installed: boolean; warning?: string }> {
    const targetDir = join(homedir(), '.openclaw', 'extensions', 'dingtalk');
    const targetManifest = join(targetDir, 'openclaw.plugin.json');

    if (existsSync(targetManifest)) {
      logger.info('DingTalk plugin already installed from local mirror');
      return { installed: true };
    }

    const candidateSources = app.isPackaged
      ? [
        join(process.resourcesPath, 'openclaw-plugins', 'dingtalk'),
        join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', 'dingtalk'),
        join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', 'dingtalk')
      ]
      : [
        join(app.getAppPath(), 'build', 'openclaw-plugins', 'dingtalk'),
        join(process.cwd(), 'build', 'openclaw-plugins', 'dingtalk'),
        join(__dirname, '../../build/openclaw-plugins/dingtalk'),
      ];

    const sourceDir = candidateSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
    if (!sourceDir) {
      logger.warn('Bundled DingTalk plugin mirror not found in candidate paths', { candidateSources });
      return {
        installed: false,
        warning: `Bundled DingTalk plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
      };
    }

    try {
      mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
      rmSync(targetDir, { recursive: true, force: true });
      cpSync(sourceDir, targetDir, { recursive: true, dereference: true });

      if (!existsSync(targetManifest)) {
        return { installed: false, warning: 'Failed to install DingTalk plugin mirror (manifest missing).' };
      }

      logger.info(`Installed DingTalk plugin from bundled mirror: ${sourceDir}`);
      return { installed: true };
    } catch (error) {
      logger.warn('Failed to install DingTalk plugin from bundled mirror:', error);
      return {
        installed: false,
        warning: 'Failed to install bundled DingTalk plugin mirror',
      };
    }
  }

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
        gatewayManager.debouncedRestart();
        return {
          success: true,
          pluginInstalled: installResult.installed,
          warning: installResult.warning,
        };
      }
      await saveChannelConfig(channelType, config);
      // Debounced restart so the gateway picks up the new channel config.
      gatewayManager.debouncedRestart();
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

  // Request Provider OAuth initialization
  ipcMain.handle('provider:requestOAuth', async (_, provider: OAuthProviderType, region?: 'global' | 'cn') => {
    try {
      logger.info(`provider:requestOAuth for ${provider}`);
      await deviceOAuthManager.startFlow(provider, region);
      return { success: true };
    } catch (error) {
      logger.error('provider:requestOAuth failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Cancel Provider OAuth
  ipcMain.handle('provider:cancelOAuth', async () => {
    try {
      await deviceOAuthManager.stopFlow();
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
  // Listen for OAuth success to automatically restart the Gateway with new tokens/configs
  deviceOAuthManager.on('oauth:success', (providerType) => {
    logger.info(`[IPC] Scheduling Gateway restart after ${providerType} OAuth success...`);
    gatewayManager.debouncedRestart();
  });

  // Get all providers with key info
  ipcMain.handle('provider:list', async () => {
    return await getAllProvidersWithKeyInfo();
  });

  // Get a specific provider
  ipcMain.handle('provider:get', async (_, providerId: string) => {
    return await getProvider(providerId);
  });

  // Save a provider configuration
  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    try {
      // Save the provider config
      await saveProvider(config);

      // Derive the unique OpenClaw key for this provider instance
      const ock = getOpenClawProviderKey(config.type, config.id);

      // Store the API key if provided
      if (apiKey !== undefined) {
        const trimmedKey = apiKey.trim();
        if (trimmedKey) {
          await storeApiKey(config.id, trimmedKey);

          // Also write to OpenClaw auth-profiles.json so the gateway can use it
          try {
            await saveProviderKeyToOpenClaw(ock, trimmedKey);
          } catch (err) {
            console.warn('Failed to save key to OpenClaw auth-profiles:', err);
          }
        }
      }

      // Sync the provider configuration to openclaw.json so Gateway knows about it
      try {
        const meta = getProviderConfig(config.type);
        const api = config.type === 'custom' || config.type === 'ollama' ? 'openai-completions' : meta?.api;

        if (api) {
          await syncProviderConfigToOpenClaw(ock, config.model, {
            baseUrl: config.baseUrl || meta?.baseUrl,
            api,
            apiKeyEnv: meta?.apiKeyEnv,
            headers: meta?.headers,
          });

          if (config.type === 'custom' || config.type === 'ollama') {
            const resolvedKey = apiKey !== undefined
              ? (apiKey.trim() || null)
              : await getApiKey(config.id);
            if (resolvedKey && config.baseUrl) {
              const modelId = config.model;
              await updateAgentModelProvider(ock, {
                baseUrl: config.baseUrl,
                api: 'openai-completions',
                models: modelId ? [{ id: modelId, name: modelId }] : [],
                apiKey: resolvedKey,
              });
            }
          }

          // Debounced restart so the gateway picks up new config/env vars.
          // Multiple rapid provider saves (e.g. during setup) are coalesced.
          logger.info(`Scheduling Gateway restart after saving provider "${ock}" config`);
          gatewayManager.debouncedRestart();
        }
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
    try {
      const existing = await getProvider(providerId);
      await deleteProvider(providerId);

      // Best-effort cleanup in OpenClaw auth profiles & openclaw.json config
      if (existing?.type) {
        try {
          const ock = getOpenClawProviderKey(existing.type, providerId);
          await removeProviderFromOpenClaw(ock);

          // Debounced restart so the gateway stops loading the deleted provider.
          logger.info(`Scheduling Gateway restart after deleting provider "${ock}"`);
          gatewayManager.debouncedRestart();
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
    try {
      await storeApiKey(providerId, apiKey);

      // Also write to OpenClaw auth-profiles.json
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      const ock = getOpenClawProviderKey(providerType, providerId);
      try {
        await saveProviderKeyToOpenClaw(ock, apiKey);
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
      const existing = await getProvider(providerId);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const previousKey = await getApiKey(providerId);
      const previousOck = getOpenClawProviderKey(existing.type, providerId);

      try {
        const nextConfig: ProviderConfig = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        const ock = getOpenClawProviderKey(nextConfig.type, providerId);

        await saveProvider(nextConfig);

        if (apiKey !== undefined) {
          const trimmedKey = apiKey.trim();
          if (trimmedKey) {
            await storeApiKey(providerId, trimmedKey);
            await saveProviderKeyToOpenClaw(ock, trimmedKey);
          } else {
            await deleteApiKey(providerId);
            await removeProviderFromOpenClaw(ock);
          }
        }

        // Sync the provider configuration to openclaw.json so Gateway knows about it
        try {
          const meta = getProviderConfig(nextConfig.type);
          const api = nextConfig.type === 'custom' || nextConfig.type === 'ollama' ? 'openai-completions' : meta?.api;

          if (api) {
            await syncProviderConfigToOpenClaw(ock, nextConfig.model, {
              baseUrl: nextConfig.baseUrl || meta?.baseUrl,
              api,
              apiKeyEnv: meta?.apiKeyEnv,
              headers: meta?.headers,
            });

            if (nextConfig.type === 'custom' || nextConfig.type === 'ollama') {
              const resolvedKey = apiKey !== undefined
                ? (apiKey.trim() || null)
                : await getApiKey(providerId);
              if (resolvedKey && nextConfig.baseUrl) {
                const modelId = nextConfig.model;
                await updateAgentModelProvider(ock, {
                  baseUrl: nextConfig.baseUrl,
                  api: 'openai-completions',
                  models: modelId ? [{ id: modelId, name: modelId }] : [],
                  apiKey: resolvedKey,
                });
              }
            }
          }

          // If this provider is the current default, update the primary model
          const defaultProviderId = await getDefaultProvider();
          if (defaultProviderId === providerId) {
            const modelOverride = nextConfig.model
              ? `${ock}/${nextConfig.model}`
              : undefined;
            if (nextConfig.type !== 'custom' && nextConfig.type !== 'ollama') {
              await setOpenClawDefaultModel(nextConfig.type, modelOverride);
            } else {
              await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
                baseUrl: nextConfig.baseUrl,
                api: 'openai-completions',
              });
            }
          }

          // Debounced restart so the gateway picks up updated config/env vars.
          logger.info(`Scheduling Gateway restart after updating provider "${ock}" config`);
          gatewayManager.debouncedRestart();
        } catch (err) {
          console.warn('Failed to sync openclaw config after provider update:', err);
        }

        return { success: true };
      } catch (error) {
        // Best-effort rollback to keep config/key consistent.
        try {
          await saveProvider(existing);
          if (previousKey) {
            await storeApiKey(providerId, previousKey);
            await saveProviderKeyToOpenClaw(previousOck, previousKey);
          } else {
            await deleteApiKey(providerId);
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
    try {
      await deleteApiKey(providerId);

      // Keep OpenClaw auth-profiles.json in sync with local key storage
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      const ock = getOpenClawProviderKey(providerType, providerId);
      try {
        if (ock) {
          await removeProviderFromOpenClaw(ock);
        }
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
    return await hasApiKey(providerId);
  });

  // Get the actual API key (for internal use only - be careful!)
  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    return await getApiKey(providerId);
  });

  // Set default provider and update OpenClaw default model
  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    try {
      await setDefaultProvider(providerId);

      // Update OpenClaw config to use this provider's default model
      const provider = await getProvider(providerId);
      if (provider) {
        try {
          const ock = getOpenClawProviderKey(provider.type, providerId);
          const providerKey = await getApiKey(providerId);

          // OAuth providers (qwen-portal, minimax-portal, minimax-portal-cn) might use OAuth OR a direct API key.
          // Treat them as OAuth only if they don't have a local API key configured.
          const OAUTH_PROVIDER_TYPES = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'];
          const isOAuthProvider = OAUTH_PROVIDER_TYPES.includes(provider.type) && !providerKey;

          if (!isOAuthProvider) {
            // Build the full model string: "openclawKey/modelId"
            const modelOverride = provider.model
              ? (provider.model.startsWith(`${ock}/`)
                ? provider.model
                : `${ock}/${provider.model}`)
              : undefined;

            if (provider.type === 'custom' || provider.type === 'ollama') {
              await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
                baseUrl: provider.baseUrl,
                api: 'openai-completions',
              });
            } else {
              await setOpenClawDefaultModel(provider.type, modelOverride);
            }

            // Keep auth-profiles in sync with the default provider instance.
            if (providerKey) {
              await saveProviderKeyToOpenClaw(ock, providerKey);
            }
          } else {
            // OAuth providers (minimax-portal, minimax-portal-cn, qwen-portal)
            const defaultBaseUrl = provider.type === 'minimax-portal'
              ? 'https://api.minimax.io/anthropic'
              : (provider.type === 'minimax-portal-cn' ? 'https://api.minimaxi.com/anthropic' : 'https://portal.qwen.ai/v1');
            const api: 'anthropic-messages' | 'openai-completions' =
              (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
                ? 'anthropic-messages'
                : 'openai-completions';

            let baseUrl = provider.baseUrl || defaultBaseUrl;
            if ((provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn') && baseUrl) {
              baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
            }

            // To ensure the OpenClaw Gateway's internal token refresher works,
            // we must save the CN provider under the "minimax-portal" key in openclaw.json
            const targetProviderKey = (provider.type === 'minimax-portal' || provider.type === 'minimax-portal-cn')
              ? 'minimax-portal'
              : provider.type;

            await setOpenClawDefaultModelWithOverride(targetProviderKey, undefined, {
              baseUrl,
              api,
              authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
              // Relies on OpenClaw Gateway native auth-profiles syncing
              apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
            });

            logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

            // Also write models.json directly so pi-ai picks up the correct baseUrl and
            // authHeader immediately, without waiting for Gateway to sync openclaw.json.
            try {
              const defaultModelId = provider.model?.split('/').pop();
              await updateAgentModelProvider(targetProviderKey, {
                baseUrl,
                api,
                authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
                apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
                models: defaultModelId ? [{ id: defaultModelId, name: defaultModelId }] : [],
              });
            } catch (err) {
              logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
            }
          }

          // For custom/ollama providers, also update the per-agent models.json
          if (
            (provider.type === 'custom' || provider.type === 'ollama') &&
            providerKey &&
            provider.baseUrl
          ) {
            const modelId = provider.model;
            await updateAgentModelProvider(ock, {
              baseUrl: provider.baseUrl,
              api: 'openai-completions',
              models: modelId ? [{ id: modelId, name: modelId }] : [],
              apiKey: providerKey,
            });
          }

          // Debounced restart so the gateway picks up the new default provider.
          if (gatewayManager.isConnected()) {
            logger.info(`Scheduling Gateway restart after provider switch to "${ock}"`);
            gatewayManager.debouncedRestart();
          }
        } catch (err) {
          console.warn('Failed to set OpenClaw default model:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });



  // Get default provider
  ipcMain.handle('provider:getDefault', async () => {
    return await getDefaultProvider();
  });

  // Validate API key by making a real test request to the provider.
  // providerId can be either a stored provider ID or a provider type.
  ipcMain.handle(
    'provider:validateKey',
    async (
      _,
      providerId: string,
      apiKey: string,
      options?: { baseUrl?: string }
    ) => {
      try {
        // First try to get existing provider
        const provider = await getProvider(providerId);

        // Use provider.type if provider exists, otherwise use providerId as the type
        // This allows validation during setup when provider hasn't been saved yet
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        // Prefer caller-supplied baseUrl (live form value) over persisted config.
        // This ensures Setup/Settings validation reflects unsaved edits immediately.
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;

        console.log(`[clawx-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, { baseUrl: resolvedBaseUrl });
      } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}

type ValidationProfile = 'openai-compatible' | 'google-query-key' | 'anthropic-header' | 'openrouter' | 'none';

/**
 * Validate API key using lightweight model-listing endpoints (zero token cost).
 * Providers are grouped into 3 auth styles:
 * - openai-compatible: Bearer auth + /models
 * - google-query-key: ?key=... + /models
 * - anthropic-header: x-api-key + anthropic-version + /models
 */
async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string }
): Promise<{ valid: boolean; error?: string }> {
  const profile = getValidationProfile(providerType);
  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-compatible':
        return await validateOpenAiCompatibleKey(providerType, trimmedKey, options?.baseUrl);
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, options?.baseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, options?.baseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return { valid: false, error: `Unsupported validation profile for provider: ${providerType}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

function logValidationStatus(provider: string, status: number): void {
  console.log(`[clawx-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>
): void {
  console.log(
    `[clawx-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`
  );
}

function getValidationProfile(providerType: string): ValidationProfile {
  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-compatible';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await fetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper: classify an HTTP response as valid / invalid / error.
 * 200 / 429 → valid (key works, possibly rate-limited).
 * 401 / 403 → invalid.
 * Everything else → return the API error message.
 */
function classifyAuthResponse(
  status: number,
  data: unknown
): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true }; // rate-limited but key is valid
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };

  // Try to extract an error message
  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return { valid: false, error: `Base URL is required for provider "${providerType}" validation` };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  // Try /models first (standard OpenAI-compatible endpoint)
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  // If /models returned 404, the provider likely doesn't implement it (e.g. MiniMax).
  // Fall back to a minimal /chat/completions POST which almost all providers support.
  if (modelsResult.error?.includes('API error: 404')) {
    console.log(
      `[clawx-validate] ${providerType} /models returned 404, falling back to /chat/completions probe`
    );
    const base = normalizeBaseUrl(trimmedBaseUrl);
    const chatUrl = `${base}/chat/completions`;
    return await performChatCompletionsProbe(providerType, chatUrl, headers);
  }

  return modelsResult;
}

/**
 * Fallback validation: send a minimal /chat/completions request.
 * We intentionally use max_tokens=1 to minimise cost. The goal is only to
 * distinguish auth errors (401/403) from a working key (200/400/429).
 * A 400 "invalid model" still proves the key itself is accepted.
 */
async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    // 401/403 → invalid key
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    // 200, 400 (bad model but key accepted), 429 → key is valid
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  // Default to the official Google Gemini API base URL if none is provided
  const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const base = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  return await performProviderValidationRequest(providerType, url, headers);
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  // Use OpenRouter's auth check endpoint instead of public /models
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

/**
 * Shell-related IPC handlers
 */
function registerShellHandlers(): void {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // Open path in file explorer
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path);
  });

  // Open path
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return await shell.openPath(path);
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
      return { success: false, error: String(error) };
    }
  });

  // Install skill
  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Uninstall skill
  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List installed skills
  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
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

/**
 * Window control handlers (for custom title bar on Windows/Linux)
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

  ipcMain.handle('media:getThumbnails', async (_, paths: Array<{ filePath: string; mimeType: string }>) => {
    const fsP = await import('fs/promises');
    const results: Record<string, { preview: string | null; fileSize: number }> = {};
    for (const { filePath, mimeType } of paths) {
      try {
        const s = await fsP.stat(filePath);
        let preview: string | null = null;
        if (mimeType.startsWith('image/')) {
          preview = await generateImagePreview(filePath, mimeType);
        }
        results[filePath] = { preview, fileSize: s.size };
      } catch {
        results[filePath] = { preview: null, fileSize: 0 };
      }
    }
    return results;
  });
}

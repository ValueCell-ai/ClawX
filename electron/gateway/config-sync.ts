import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, cpSync, mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { listConfiguredChannels } from '../utils/channel-config';
import { syncGatewayTokenToConfig, syncBrowserConfigToOpenClaw, sanitizeOpenClawConfig } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';

export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, string> = {
  dingtalk: 'dingtalk',
  wecom: 'wecom',
  feishu: 'feishu-openclaw-plugin',
  qqbot: 'qqbot',
};

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(pkgJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function buildPluginCandidateSources(pluginDirName: string): string[] {
  return app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
    ];
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * Compares the installed version in ~/.openclaw/extensions/ with the
 * bundled version and overwrites if the bundled version is newer.
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): void {
  for (const channelType of configuredChannels) {
    const pluginDirName = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginDirName) continue;

    const targetDir = join(homedir(), '.openclaw', 'extensions', pluginDirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    if (!existsSync(targetManifest)) continue; // not installed, nothing to upgrade

    const sources = buildPluginCandidateSources(pluginDirName);
    const sourceDir = sources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
    if (!sourceDir) continue; // no bundled source available

    const installedVersion = readPluginVersion(join(targetDir, 'package.json'));
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) continue;

    logger.info(`[plugin] Auto-upgrading ${channelType} plugin: ${installedVersion} → ${sourceVersion}`);
    try {
      mkdirSync(join(homedir(), '.openclaw', 'extensions'), { recursive: true });
      rmSync(targetDir, { recursive: true, force: true });
      cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    } catch (err) {
      logger.warn(`[plugin] Failed to auto-upgrade ${channelType} plugin:`, err);
    }
  }
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  await syncProxyConfigToOpenClaw(appSettings);

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  try {
    const configuredChannels = await listConfiguredChannels();
    ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  try {
    await syncGatewayTokenToConfig(appSettings.gatewayToken);
  } catch (err) {
    logger.warn('Failed to sync gateway token to openclaw.json:', err);
  }

  try {
    await syncBrowserConfigToOpenClaw();
  } catch (err) {
    logger.warn('Failed to sync browser config to openclaw.json:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      if (defaultProviderType && defaultProviderKey) {
        const envVar = getProviderEnvVar(defaultProviderType);
        if (envVar) {
          providerEnv[envVar] = defaultProviderKey;
          loadedProviderKeyCount++;
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      if (key) {
        const envVar = getProviderEnvVar(providerType);
        if (envVar) {
          providerEnv[envVar] = key;
          loadedProviderKeyCount++;
        }
      }
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const configuredChannels = await listConfiguredChannels();
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();
  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  const baseEnvPatched = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  const forkEnv: Record<string, string | undefined> = {
    ...baseEnvPatched,
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
  };

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}

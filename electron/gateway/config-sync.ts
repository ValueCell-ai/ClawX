import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannelsFromConfig, readOpenClawConfig } from '../utils/channel-config';
import { sanitizeOpenClawConfig, batchSyncConfigFields } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { copyPluginFromNodeModules, fixupPluginManifest, cpSyncSafe } from '../utils/plugin-install';
import { stripSystemdSupervisorEnv } from './config-sync-env';


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

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  feishu: { dirName: 'feishu-openclaw-plugin', npmName: '@larksuite/openclaw-lark' },

  'openclaw-weixin': { dirName: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin' },
};

/**
 * OpenClaw 3.22+ ships Discord, Telegram, and other channels as built-in
 * extensions.  If a previous ClawX version copied one of these into
 * ~/.openclaw/extensions/, the broken copy overrides the working built-in
 * plugin and must be removed.
 */
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(): void {
  for (const ext of BUILTIN_CHANNEL_EXTENSIONS) {
    const extDir = join(homedir(), '.openclaw', 'extensions', ext);
    if (existsSync(fsPath(extDir))) {
      logger.info(`[plugin] Removing stale built-in extension copy: ${ext}`);
      try {
        rmSync(fsPath(extDir), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[plugin] Failed to remove stale extension ${ext}:`, err);
      }
    }
  }
}

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function buildBundledPluginSources(pluginDirName: string): string[] {
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
 * - Packaged mode: uses bundled plugins from resources/ (includes deps)
 * - Dev mode: falls back to node_modules/ with pnpm-aware dep collection
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): void {
  for (const channelType of configuredChannels) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const { dirName, npmName } = pluginInfo;

    const targetDir = join(homedir(), '.openclaw', 'extensions', dirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    const isInstalled = existsSync(fsPath(targetManifest));
    const installedVersion = isInstalled ? readPluginVersion(join(targetDir, 'package.json')) : null;

    // Try bundled sources first (packaged mode or if bundle-plugins was run)
    const bundledSources = buildBundledPluginSources(dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

    if (bundledDir) {
      const sourceVersion = readPluginVersion(join(bundledDir, 'package.json'));
      // Install or upgrade if version differs or plugin not installed
      if (!isInstalled || (sourceVersion && installedVersion && sourceVersion !== installedVersion)) {
        logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (bundled)`);
        try {
          mkdirSync(fsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
          rmSync(fsPath(targetDir), { recursive: true, force: true });
          cpSyncSafe(bundledDir, targetDir);
          fixupPluginManifest(targetDir);
        } catch (err) {
          logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin:`, err);
        }
      } else if (isInstalled) {
        // Same version already installed — still patch manifest ID in case it was
        // never corrected (e.g. installed before MANIFEST_ID_FIXES included this plugin).
        fixupPluginManifest(targetDir);
      }
      continue;
    }

    // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
    if (!app.isPackaged) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (!existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) continue;
      const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
      if (!sourceVersion) continue;
      // Skip only if installed AND same version — but still patch manifest ID.
      if (isInstalled && installedVersion && sourceVersion === installedVersion) {
        fixupPluginManifest(targetDir);
        continue;
      }

      logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`);

      try {
        mkdirSync(fsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
        copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
        fixupPluginManifest(targetDir);
      } catch (err) {
        logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin from node_modules:`, err);
      }
    }
  }
}

/**
 * Ensure extension-specific packages are resolvable from shared dist/ chunks.
 *
 * OpenClaw's Rollup bundler creates shared chunks in dist/ (e.g.
 * sticker-cache-*.js) that eagerly `import "grammy"`.  ESM bare specifier
 * resolution walks from the importing file's directory upward:
 *   dist/node_modules/ → openclaw/node_modules/ → …
 * It does NOT search `dist/extensions/telegram/node_modules/`.
 *
 * NODE_PATH only works for CJS require(), NOT for ESM import statements.
 *
 * Fix: create symlinks in openclaw/node_modules/ pointing to packages in
 * dist/extensions/<ext>/node_modules/.  This makes the standard ESM
 * resolution algorithm find them.  Skip-if-exists avoids overwriting
 * openclaw's own deps (they take priority).
 */
let _extensionDepsLinked = false;

/**
 * Reset the extension-deps-linked cache so the next
 * ensureExtensionDepsResolvable() call re-scans and links.
 * Called before each Gateway launch to pick up newly installed extensions.
 */
export function resetExtensionDepsLinked(): void {
  _extensionDepsLinked = false;
}

function ensureExtensionDepsResolvable(openclawDir: string): void {
  if (_extensionDepsLinked) return;

  const extDir = join(openclawDir, 'dist', 'extensions');
  const topNM = join(openclawDir, 'node_modules');
  let linkedCount = 0;

  try {
    if (!existsSync(extDir)) return;

    for (const ext of readdirSync(extDir, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      const extNM = join(extDir, ext.name, 'node_modules');
      if (!existsSync(extNM)) continue;

      for (const pkg of readdirSync(extNM, { withFileTypes: true })) {
        if (pkg.name === '.bin') continue;

        if (pkg.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          const scopeDir = join(extNM, pkg.name);
          let scopeEntries;
          try { scopeEntries = readdirSync(scopeDir, { withFileTypes: true }); } catch { continue; }
          for (const sub of scopeEntries) {
            if (!sub.isDirectory()) continue;
            const dest = join(topNM, pkg.name, sub.name);
            if (existsSync(dest)) continue;
            try {
              mkdirSync(join(topNM, pkg.name), { recursive: true });
              symlinkSync(join(scopeDir, sub.name), dest);
              linkedCount++;
            } catch { /* skip on error — non-fatal */ }
          }
        } else {
          const dest = join(topNM, pkg.name);
          if (existsSync(dest)) continue;
          try {
            mkdirSync(topNM, { recursive: true });
            symlinkSync(join(extNM, pkg.name), dest);
            linkedCount++;
          } catch { /* skip on error — non-fatal */ }
        }
      }
    }
  } catch {
    // extensions dir may not exist or be unreadable — non-fatal
  }

  if (linkedCount > 0) {
    logger.info(`[extension-deps] Linked ${linkedCount} extension packages into ${topNM}`);
  }

  _extensionDepsLinked = true;
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  // Reset the extension-deps cache so that newly installed extensions
  // (e.g. user added a channel while the app was running) get their
  // node_modules linked on the next Gateway spawn.
  resetExtensionDepsLinked();

  await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await cleanupDanglingWeChatPluginState();
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    cleanupStaleBuiltInExtensions();
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  // Read config once and reuse for both listConfiguredChannels and plugins.allow.
  try {
    const rawCfg = await readOpenClawConfig();
    const configuredChannels = await listConfiguredChannelsFromConfig(rawCfg);

    // Also ensure plugins referenced in plugins.allow are installed even if
    // they have no channels.X section yet (e.g. qqbot added via plugins.allow
    // but never fully saved through ClawX UI).
    try {
      const allowList = Array.isArray(rawCfg.plugins?.allow) ? (rawCfg.plugins!.allow as string[]) : [];
      const pluginIdToChannel: Record<string, string> = {};
      for (const [channelType, info] of Object.entries(CHANNEL_PLUGIN_MAP)) {
        pluginIdToChannel[info.dirName] = channelType;
      }

      pluginIdToChannel['openclaw-lark'] = 'feishu';
      pluginIdToChannel['feishu-openclaw-plugin'] = 'feishu';

      for (const pluginId of allowList) {
        const channelType = pluginIdToChannel[pluginId] ?? pluginId;
        if (CHANNEL_PLUGIN_MAP[channelType] && !configuredChannels.includes(channelType)) {
          configuredChannels.push(channelType);
        }
      }

    } catch (err) {
      logger.warn('[plugin] Failed to augment channel list from plugins.allow:', err);
    }

    ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  // Batch gateway token, browser config, and session idle into one read+write cycle.
  try {
    await batchSyncConfigFields(appSettings.gatewayToken);
  } catch (err) {
    logger.warn('Failed to batch-sync config fields to openclaw.json:', err);
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
    const rawCfg = await readOpenClawConfig();
    const configuredChannels = await listConfiguredChannelsFromConfig(rawCfg);
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
    ...stripSystemdSupervisorEnv(baseEnvPatched),
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
  };

  // Ensure extension-specific packages (e.g. grammy from the telegram
  // extension) are resolvable by shared dist/ chunks via symlinks in
  // openclaw/node_modules/.  NODE_PATH does NOT work for ESM imports.
  ensureExtensionDepsResolvable(openclawDir);

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

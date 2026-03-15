import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, cpSync, mkdirSync, rmSync, readdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import {
  getOpenClawDir,
  getOpenClawEntryPath,
  getOpenClawExtensionsDir,
  isOpenClawPresent,
} from '../utils/paths';
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

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  feishu: { dirName: 'feishu-openclaw-plugin', npmName: '@larksuite/openclaw-lark' },
  qqbot: { dirName: 'qqbot', npmName: '@sliverp/qqbot' },
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

/** Walk up from a path until we find a parent named node_modules. */
function findParentNodeModules(startPath: string): string | null {
  let dir = startPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** List packages inside a node_modules dir (handles @scoped packages). */
function listPackagesInDir(nodeModulesDir: string): Array<{ name: string; fullPath: string }> {
  const result: Array<{ name: string; fullPath: string }> = [];
  if (!existsSync(nodeModulesDir)) return result;
  const SKIP = new Set(['.bin', '.package-lock.json', '.modules.yaml', '.pnpm']);
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP.has(entry.name)) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      try {
        for (const sub of readdirSync(entryPath)) {
          result.push({ name: `${entry.name}/${sub}`, fullPath: join(entryPath, sub) });
        }
      } catch { /* ignore */ }
    } else {
      result.push({ name: entry.name, fullPath: entryPath });
    }
  }
  return result;
}

/**
 * Copy a plugin from a pnpm node_modules location, including its
 * transitive runtime dependencies (replicates bundle-openclaw-plugins.mjs
 * logic).
 */
function copyPluginFromNodeModules(npmPkgPath: string, targetDir: string, npmName: string): void {
  let realPath: string;
  try {
    realPath = realpathSync(npmPkgPath);
  } catch {
    throw new Error(`Cannot resolve real path for ${npmPkgPath}`);
  }

  // 1. Copy plugin package itself
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(realPath, targetDir, { recursive: true, dereference: true });

  // 2. Collect transitive deps from pnpm virtual store
  const rootVirtualNM = findParentNodeModules(realPath);
  if (!rootVirtualNM) {
    logger.warn(`[plugin] Cannot find virtual store node_modules for ${npmName}, plugin may lack deps`);
    return;
  }

  // Read peer deps to skip (they're provided by the host gateway)
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  try {
    const pluginPkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch { /* ignore */ }

  const collected = new Map<string, string>(); // realPath → packageName
  const queue: Array<{ nodeModulesDir: string; skipPkg: string }> = [
    { nodeModulesDir: rootVirtualNM, skipPkg: npmName },
  ];

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift()!;
    for (const { name, fullPath } of listPackagesInDir(nodeModulesDir)) {
      if (name === skipPkg) continue;
      if (SKIP_PACKAGES.has(name) || name.startsWith('@types/')) continue;
      let depRealPath: string;
      try {
        depRealPath = realpathSync(fullPath);
      } catch { continue; }
      if (collected.has(depRealPath)) continue;
      collected.set(depRealPath, name);
      const depVirtualNM = findParentNodeModules(depRealPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  // 3. Copy flattened deps into targetDir/node_modules/
  const outputNM = join(targetDir, 'node_modules');
  mkdirSync(outputNM, { recursive: true });
  const copiedNames = new Set<string>();
  for (const [depRealPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const dest = join(outputNM, pkgName);
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(depRealPath, dest, { recursive: true, dereference: true });
    } catch { /* skip individual dep failures */ }
  }

  logger.info(`[plugin] Copied ${copiedNames.size} deps for ${npmName}`);
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

    const extensionsDir = getOpenClawExtensionsDir();
    const targetDir = join(extensionsDir, dirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    if (!existsSync(targetManifest)) continue; // not installed, nothing to upgrade

    const installedVersion = readPluginVersion(join(targetDir, 'package.json'));

    // Try bundled sources first (packaged mode or if bundle-plugins was run)
    const bundledSources = buildBundledPluginSources(dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));

    if (bundledDir) {
      const sourceVersion = readPluginVersion(join(bundledDir, 'package.json'));
      if (sourceVersion && installedVersion && sourceVersion !== installedVersion) {
        logger.info(`[plugin] Auto-upgrading ${channelType} plugin: ${installedVersion} → ${sourceVersion} (bundled)`);
        try {
          mkdirSync(extensionsDir, { recursive: true });
          rmSync(targetDir, { recursive: true, force: true });
          cpSync(bundledDir, targetDir, { recursive: true, dereference: true });
        } catch (err) {
          logger.warn(`[plugin] Failed to auto-upgrade ${channelType} plugin:`, err);
        }
      }
      continue;
    }

    // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
    if (!app.isPackaged) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (!existsSync(join(npmPkgPath, 'openclaw.plugin.json'))) continue;
      const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
      if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) continue;

      logger.info(`[plugin] Auto-upgrading ${channelType} plugin: ${installedVersion} → ${sourceVersion} (dev/node_modules)`);
      try {
        mkdirSync(extensionsDir, { recursive: true });
        copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
      } catch (err) {
        logger.warn(`[plugin] Failed to auto-upgrade ${channelType} plugin from node_modules:`, err);
      }
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

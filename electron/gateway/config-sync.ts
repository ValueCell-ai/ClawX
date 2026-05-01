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
import {
  getOpenClawConfigDir,
  getOpenClawDir,
  getOpenClawEntryPath,
  getOpenClawResolvedDir,
  getOpenClawSkillsDir,
  isOpenClawPresent,
} from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannelsFromConfig, readOpenClawConfig } from '../utils/channel-config';
import { sanitizeOpenClawConfig, batchSyncConfigFields } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { copyPluginFromNodeModules, fixupPluginManifest, cpSyncSafe } from '../utils/plugin-install';
import { stripSystemdSupervisorEnv } from './config-sync-env';
import { cleanupAgentsSymlinkedSkills, cleanupStalePluginRuntimeDeps } from './skills-symlink-cleanup';
import {
  buildPrelaunchMaintenanceCacheKey,
  directoryChildrenSignature,
  pathSignature,
  runCachedPrelaunchMaintenanceTask,
  type PrelaunchMaintenanceRunResult,
  type PrelaunchMaintenanceTaskName,
} from './prelaunch-maintenance-cache';


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

export interface GatewayPrelaunchSyncSummary {
  timingsMs: Record<string, number>;
  maintenance: Partial<Record<PrelaunchMaintenanceTaskName, PrelaunchMaintenanceRunResult>>;
  configuredChannels: string[];
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

function measureSync<T>(timings: Record<string, number>, key: string, fn: () => T): T {
  const startedAt = Date.now();
  try {
    return fn();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

async function measureAsync<T>(timings: Record<string, number>, key: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

function appVersionForCache(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
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
 * Remove channel plugin extensions from ~/.openclaw/extensions/ when their
 * corresponding channel is no longer configured.  This prevents the Gateway
 * from scanning residual plugin manifests that were installed by a previous
 * configuration but are no longer needed.
 */
function cleanupUnconfiguredChannelPlugins(configuredChannels: string[]): void {
  const configuredSet = new Set(configuredChannels);

  for (const [channelType, pluginInfo] of Object.entries(CHANNEL_PLUGIN_MAP)) {
    if (configuredSet.has(channelType)) continue;

    const { dirName } = pluginInfo;
    const targetDir = join(homedir(), '.openclaw', 'extensions', dirName);
    if (!existsSync(fsPath(targetDir))) continue;

    logger.info(`[plugin] Removing unconfigured channel plugin: ${channelType} (${dirName})`);
    try {
      rmSync(fsPath(targetDir), { recursive: true, force: true });
    } catch (err) {
      logger.warn(`[plugin] Failed to remove unconfigured channel plugin ${channelType}:`, err);
    }
  }
}

function buildPluginSourceSignatures(configuredChannels: string[]): Record<string, unknown> {
  const signatures: Record<string, unknown> = {};
  for (const channelType of [...configuredChannels].sort()) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const bundledSources = buildBundledPluginSources(pluginInfo.dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));
    const devPkgPath = join(process.cwd(), 'node_modules', ...pluginInfo.npmName.split('/'));
    const sourceDir = bundledDir || (!app.isPackaged ? devPkgPath : '');
    signatures[channelType] = sourceDir
      ? {
        sourceDir,
        manifest: pathSignature(join(sourceDir, 'openclaw.plugin.json')),
        packageJson: pathSignature(join(sourceDir, 'package.json')),
      }
      : 'missing';
  }
  return signatures;
}

function buildPluginMaintenanceCacheKey(openclawDir: string, configuredChannels: string[]): string {
  return buildPrelaunchMaintenanceCacheKey({
    task: 'plugin-maintenance',
    appVersion: appVersionForCache(),
    openclawDir,
    cwd: process.cwd(),
    configuredChannels: [...configuredChannels].sort(),
    extensionsDir: directoryChildrenSignature(join(homedir(), '.openclaw', 'extensions')),
    sourceSignatures: buildPluginSourceSignatures(configuredChannels),
  });
}

function buildSkillsSymlinkCleanupCacheKey(openclawDir: string): string {
  const workspaceSkillsDir = join(getOpenClawConfigDir(), 'workspace', 'skills');
  return buildPrelaunchMaintenanceCacheKey({
    task: 'skills-symlink-cleanup',
    appVersion: appVersionForCache(),
    openclawDir,
    skillsDir: getOpenClawSkillsDir(),
    skillsDirSignature: directoryChildrenSignature(getOpenClawSkillsDir()),
    workspaceSkillsDir,
    workspaceSkillsDirSignature: directoryChildrenSignature(workspaceSkillsDir),
  });
}

function buildRuntimeDepsCleanupCacheKey(openclawDir: string): string {
  const runtimeDepsDir = join(getOpenClawConfigDir(), 'plugin-runtime-deps');
  return buildPrelaunchMaintenanceCacheKey({
    task: 'runtime-deps-cleanup',
    appVersion: appVersionForCache(),
    openclawDir,
    currentOpenClawDir: getOpenClawResolvedDir(),
    runtimeDepsDir,
    runtimeDepsDirSignature: directoryChildrenSignature(runtimeDepsDir),
  });
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
  openclawDir: string,
): Promise<GatewayPrelaunchSyncSummary> {
  const timingsMs: Record<string, number> = {};
  const maintenance: GatewayPrelaunchSyncSummary['maintenance'] = {};
  let configuredChannels: string[] = [];

  // Reset the extension-deps cache so that newly installed extensions
  // (e.g. user added a channel while the app was running) get their
  // node_modules linked on the next Gateway spawn.
  resetExtensionDepsLinked();

  await measureAsync(timingsMs, 'proxySyncMs', async () => {
    await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });
  });

  try {
    await measureAsync(timingsMs, 'sanitizeMs', sanitizeOpenClawConfig);
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await measureAsync(timingsMs, 'wechatStateCleanupMs', cleanupDanglingWeChatPluginState);
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    measureSync(timingsMs, 'staleBuiltinExtensionCleanupMs', cleanupStaleBuiltInExtensions);
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  // Remove stray symlinks under ~/.openclaw/skills whose realpath resolves
  // inside ~/.agents/skills.  OpenClaw's hardened skill loader rejects these
  // on every launch (reason=symlink-escape) and the underlying skills are
  // still discovered via the agents-skills-personal source, so the symlinks
  // are pure log noise.  Transitional workaround for openclaw/openclaw#59219.
  try {
    const result = measureSync(timingsMs, 'skillsCleanupMs', () => runCachedPrelaunchMaintenanceTask(
      'skills-symlink-cleanup',
      () => buildSkillsSymlinkCleanupCacheKey(openclawDir),
      cleanupAgentsSymlinkedSkills,
    ));
    maintenance['skills-symlink-cleanup'] = result;
  } catch (err) {
    logger.warn('Failed to clean .agents/skills-targeted skill symlinks:', err);
  }

  // Remove stale OpenClaw runtime-deps cache roots that point at an older
  // worktree/package.  Those symlink trees can make Gateway plugin setup spend
  // a long time in synchronous fs.open/copy calls before the RPC router is
  // responsive.
  try {
    const result = measureSync(timingsMs, 'runtimeDepsCleanupMs', () => runCachedPrelaunchMaintenanceTask(
      'runtime-deps-cleanup',
      () => buildRuntimeDepsCleanupCacheKey(openclawDir),
      cleanupStalePluginRuntimeDeps,
    ));
    maintenance['runtime-deps-cleanup'] = result;
  } catch (err) {
    logger.warn('Failed to clean stale OpenClaw plugin runtime deps:', err);
  }

  // Auto-upgrade installed plugins before Gateway starts so that
  // the plugin manifest ID matches what sanitize wrote to the config.
  // Only install/upgrade plugins for channels that are actually configured
  // in openclaw.json — do NOT expand the list from plugins.allow.
  try {
    configuredChannels = await measureAsync(timingsMs, 'configuredChannelsMs', async () => {
      const rawCfg = await readOpenClawConfig();
      return await listConfiguredChannelsFromConfig(rawCfg);
    });

    const result = measureSync(timingsMs, 'pluginMaintenanceMs', () => runCachedPrelaunchMaintenanceTask(
      'plugin-maintenance',
      () => buildPluginMaintenanceCacheKey(openclawDir, configuredChannels),
      () => {
        ensureConfiguredPluginsUpgraded(configuredChannels);
        cleanupUnconfiguredChannelPlugins(configuredChannels);
      },
    ));
    maintenance['plugin-maintenance'] = result;
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  // Batch gateway token, browser config, and session idle into one read+write cycle.
  try {
    await measureAsync(timingsMs, 'configFieldSyncMs', async () => {
      await batchSyncConfigFields(appSettings.gatewayToken);
    });
  } catch (err) {
    logger.warn('Failed to batch-sync config fields to openclaw.json:', err);
  }

  return {
    timingsMs,
    maintenance,
    configuredChannels,
  };
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
  const timingsMs: Record<string, number> = {};
  const totalStartedAt = Date.now();
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await measureAsync(timingsMs, 'settingsMs', getAllSettings);
  const prelaunchSummary = await measureAsync(timingsMs, 'prelaunchSyncMs', async () => (
    await syncGatewayConfigBeforeLaunch(appSettings, openclawDir)
  ));

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

  const { providerEnv, loadedProviderKeyCount } = await measureAsync(timingsMs, 'providerEnvMs', loadProviderEnv);
  const { skipChannels, channelStartupSummary } = await measureAsync(
    timingsMs,
    'channelStartupPolicyMs',
    resolveChannelStartupPolicy,
  );
  const uvEnv = await measureAsync(timingsMs, 'uvEnvMs', getUvMirrorEnv);
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
  measureSync(timingsMs, 'extensionDepsMs', () => ensureExtensionDepsResolvable(openclawDir));
  timingsMs.totalMs = Date.now() - totalStartedAt;

  logger.info('[metric] gateway.prelaunch', {
    ...prelaunchSummary.timingsMs,
    ...timingsMs,
    maintenance: prelaunchSummary.maintenance,
    configuredChannelCount: prelaunchSummary.configuredChannels.length,
  });

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

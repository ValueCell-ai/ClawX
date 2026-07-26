/**
 * Shared OpenClaw Plugin Install Utilities
 *
 * Provides version-aware install/upgrade logic for bundled OpenClaw plugins
 * (DingTalk, WeCom, Feishu, WeChat, Discord, QQBot, WhatsApp).  Used both at app startup (to auto-upgrade
 * stale plugins) and when a user configures a channel.
 */
import { app } from 'electron';
import path from 'node:path';
import { existsSync, cpSync, copyFileSync, statSync, lstatSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { readdir, stat, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger';
import { getOpenClawResolvedDir } from './paths';
import {
  upsertPluginInstallRecordsIntoSqlite,
  removePluginInstallRecordsFromSqlite,
  ensureOpenClawStateDirExists,
} from './plugin-install-index';

function normalizeFsPathForWindows(filePath: string): string {
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

function fsPath(filePath: string): string {
  return normalizeFsPathForWindows(filePath);
}

/**
 * Unicode-safe recursive directory copy.
 *
 * Node.js `cpSync` / `cp` crash on Windows when paths contain non-ASCII
 * characters such as Chinese (nodejs/node#54476).  On Windows we fall back
 * to a manual recursive walk using `copyFileSync` which is unaffected.
 */
export function cpSyncSafe(src: string, dest: string): void {
  if (process.platform !== 'win32') {
    cpSync(fsPath(src), fsPath(dest), { recursive: true, dereference: true });
    return;
  }
  // Windows: manual recursive copy with per-file copyFileSync
  _copyDirSyncRecursive(fsPath(src), fsPath(dest));
}

function _copyDirSyncRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = join(src, entry.name);
    const destChild = join(dest, entry.name);
    // Dereference symlinks: use statSync (follows links) instead of lstatSync
    const info = statSync(srcChild);
    if (info.isDirectory()) {
      _copyDirSyncRecursive(srcChild, destChild);
    } else {
      copyFileSync(srcChild, destChild);
    }
  }
}

/**
 * Async variant of `cpSyncSafe` for use with fs/promises.
 */
export async function cpAsyncSafe(src: string, dest: string): Promise<void> {
  if (process.platform !== 'win32') {
    const { cp } = await import('node:fs/promises');
    await cp(fsPath(src), fsPath(dest), { recursive: true, dereference: true });
    return;
  }
  // Windows: manual recursive copy with per-file copyFile
  await _copyDirAsyncRecursive(fsPath(src), fsPath(dest));
}

async function _copyDirAsyncRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = join(src, entry.name);
    const destChild = join(dest, entry.name);
    const info = await stat(srcChild);
    if (info.isDirectory()) {
      await _copyDirAsyncRecursive(srcChild, destChild);
    } else {
      await copyFile(srcChild, destChild);
    }
  }
}

function asErrnoException(error: unknown): NodeJS.ErrnoException | null {
  if (error && typeof error === 'object') {
    return error as NodeJS.ErrnoException;
  }
  return null;
}

function toErrorDiagnostic(error: unknown): { code?: string; name?: string; message: string } {
  const errno = asErrnoException(error);
  if (!errno) {
    return { message: String(error) };
  }

  return {
    code: typeof errno.code === 'string' ? errno.code : undefined,
    name: errno.name,
    message: errno.message || String(error),
  };
}

// ── Known plugin-ID corrections ─────────────────────────────────────────────
// Some npm packages ship with an openclaw.plugin.json whose "id" field
// doesn't match the ID the plugin code actually exports.  After copying we
// patch both the manifest AND the compiled JS so the Gateway accepts them.
const MANIFEST_ID_FIXES: Record<string, string> = {
  'wecom-openclaw-plugin': 'wecom',
};

/**
 * After a plugin has been copied to ~/.openclaw/extensions/<dir>, fix any
 * known manifest-ID mismatches so the Gateway can load the plugin.
 * Also keeps package.json npm metadata usable by OpenClaw's repair planner.
 */
export function fixupPluginManifest(targetDir: string): void {
  // 1. Fix openclaw.plugin.json id
  const manifestPath = join(targetDir, 'openclaw.plugin.json');
  try {
    const raw = readFileSync(fsPath(manifestPath), 'utf-8');
    const manifest = JSON.parse(raw);
    const oldId = manifest.id as string | undefined;
    let modified = false;
    if (oldId && MANIFEST_ID_FIXES[oldId]) {
      const newId = MANIFEST_ID_FIXES[oldId];
      manifest.id = newId;
      modified = true;
      logger.info(`[plugin] Fixed manifest ID: ${oldId} → ${newId}`);
    }

    // OpenClaw 2026.7.1 treats configured channel plugins without a static
    // channelConfigs descriptor as stale/missing and invokes its npm repair
    // flow. The WeCom package has no descriptor upstream, so provide a
    // permissive schema that preserves ClawX's existing channel config fields.
    if (manifest.id === 'wecom' && !manifest.channelConfigs?.wecom) {
      manifest.channelConfigs = {
        ...(manifest.channelConfigs ?? {}),
        wecom: {
          schema: {
            type: 'object',
            additionalProperties: true,
          },
        },
      };
      modified = true;
      logger.info('[plugin] Added WeCom channelConfigs compatibility descriptor');
    }

    if (modified) {
      writeFileSync(fsPath(manifestPath), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    }
  } catch {
    // manifest may not exist yet — ignore
  }

  // 2. Keep package.json package-manager metadata valid
  const pkgPath = join(targetDir, 'package.json');
  try {
    const raw = readFileSync(fsPath(pkgPath), 'utf-8');
    const pkg = JSON.parse(raw);
    let modified = false;

    // Keep the real upstream npm package name/spec even though ClawX patches
    // the effective plugin id. Rewriting these to the non-existent
    // `@wecom/wecom` package makes OpenClaw's repair planner fail before the
    // Gateway starts. Restore metadata previously rewritten by older ClawX
    // compatibility code.
    if (pkg.name === '@wecom/wecom') {
      pkg.name = '@wecom/wecom-openclaw-plugin';
      modified = true;
    }
    const install = pkg.openclaw?.install;
    if (install?.npmSpec === '@wecom/wecom') {
      install.npmSpec = '@wecom/wecom-openclaw-plugin';
      modified = true;
    }

    if (modified) {
      writeFileSync(fsPath(pkgPath), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      logger.info(`[plugin] Restored package.json npm metadata in ${targetDir}`);
    }
  } catch {
    // ignore
  }

  // 3. Fix hardcoded plugin IDs in compiled JS entry files.
  //    The Gateway validates that the JS export's `id` matches the manifest.
  patchPluginEntryIds(targetDir);
}

/**
 * Patch the compiled JS entry files so the hardcoded `id` field in the
 * plugin export matches the manifest.  Without this, the Gateway rejects
 * the plugin with "plugin id mismatch".
 */
function patchPluginEntryIds(targetDir: string): void {
  const pkgPath = join(targetDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(fsPath(pkgPath), 'utf-8'));
  } catch {
    return;
  }

  const entryFiles = [pkg.main, pkg.module].filter(Boolean) as string[];

  for (const entry of entryFiles) {
    const entryPath = join(targetDir, entry);
    if (!existsSync(fsPath(entryPath))) continue;

    let content: string;
    try {
      content = readFileSync(fsPath(entryPath), 'utf-8');
    } catch {
      continue;
    }

    let patched = false;
    for (const [wrongId, correctId] of Object.entries(MANIFEST_ID_FIXES)) {
      // Match patterns like:  id: "wecom-openclaw-plugin"  or  id: 'wecom-openclaw-plugin'
      const escapedWrongId = wrongId.replace(/-/g, '\\-');
      const pattern = new RegExp(`(\\bid\\s*:\\s*)(["'])${escapedWrongId}\\2`, 'g');
      const replaced = content.replace(pattern, `$1$2${correctId}$2`);
      if (replaced !== content) {
        content = replaced;
        patched = true;
        logger.info(`[plugin] Patched plugin ID in ${entry}: "${wrongId}" → "${correctId}"`);
      }
    }

    if (patched) {
      writeFileSync(fsPath(entryPath), content, 'utf-8');
    }
  }
}

// ── Plugin npm name mapping ──────────────────────────────────────────────────

const PLUGIN_NPM_NAMES: Record<string, string> = {
  dingtalk: '@soimy/dingtalk',
  wecom: '@wecom/wecom-openclaw-plugin',
  'feishu-openclaw-plugin': '@larksuite/openclaw-lark',
  discord: '@openclaw/discord',
  qqbot: '@openclaw/qqbot',
  whatsapp: '@openclaw/whatsapp',

  'openclaw-weixin': '@tencent-weixin/openclaw-weixin',
};

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

/**
 * Channel plugins whose ClawX-managed mirrors need synchronized install
 * metadata. OpenClaw 2026.6+ reads these records from SQLite for trust checks;
 * OpenClaw 2026.7.1 also uses them to decide whether startup migrations should
 * update an installed plugin.
 */
type TrustedOfficialExtensionPlugin = {
  npmName: string;
  /** Effective manifest/config id when it differs from the mirror directory. */
  pluginId?: string;
  /** Path records keep OpenClaw from replacing a ClawX-patched mirror. */
  recordSource?: 'npm' | 'path';
  legacyPluginIds?: string[];
};

const TRUSTED_OFFICIAL_EXTENSION_PLUGINS: Record<string, TrustedOfficialExtensionPlugin> = {
  dingtalk: { npmName: '@soimy/dingtalk' },
  // WeCom intentionally runs under ClawX's legacy-compatible `wecom` id even
  // though the upstream package manifest still declares
  // `wecom-openclaw-plugin`. Keep it path-owned so startup migration does not
  // replace the compatibility-patched mirror with the raw npm package.
  wecom: {
    npmName: '@wecom/wecom-openclaw-plugin',
    recordSource: 'path',
    legacyPluginIds: ['wecom-openclaw-plugin'],
  },
  // @larksuite/openclaw-lark 2026.7.9 declares ./dist/index.js as `main`, but
  // publishes its runtime entry as ./index.js. OpenClaw 2026.7.1 rejects old
  // managed npm records during its post-core smoke check. Make ClawX's complete
  // mirror the canonical path-owned payload instead.
  'feishu-openclaw-plugin': {
    npmName: '@larksuite/openclaw-lark',
    pluginId: 'openclaw-lark',
    recordSource: 'path',
    legacyPluginIds: ['feishu-openclaw-plugin', 'feishu'],
  },
  whatsapp: { npmName: '@openclaw/whatsapp' },
  discord: { npmName: '@openclaw/discord' },
  qqbot: { npmName: '@openclaw/qqbot' },
  'openclaw-weixin': { npmName: '@tencent-weixin/openclaw-weixin' },
  'clawx-openai-image': {
    npmName: 'clawx-openai-image-plugin',
    recordSource: 'path',
  },
};

type TrustedOfficialPluginInstallRecord = Record<string, unknown> & {
  source: 'npm' | 'path';
  spec: string;
  installPath: string;
  version: string;
  installedAt: string;
};

/** Store plain paths for OpenClaw install-record matching (no Windows \\?\ prefix). */
function normalizePluginInstallPathForRecord(targetDir: string): string | null {
  try {
    const resolved = realpathSync(targetDir);
    return path.normalize(resolved);
  } catch {
    return path.normalize(targetDir);
  }
}

function buildTrustedOfficialPluginInstallRecord(
  pluginDirName: string,
  targetDir: string,
): { pluginId: string; record: TrustedOfficialPluginInstallRecord } | null {
  const definition = TRUSTED_OFFICIAL_EXTENSION_PLUGINS[pluginDirName];
  if (!definition) return null;

  const version = readPluginVersion(join(targetDir, 'package.json'));
  const installPath = normalizePluginInstallPathForRecord(targetDir);
  if (!version || !installPath) return null;

  const pluginId = definition.pluginId ?? pluginDirName;
  const installedAt = new Date().toISOString();
  if (definition.recordSource === 'path') {
    return {
      pluginId,
      record: {
        source: 'path',
        spec: targetDir,
        sourcePath: targetDir,
        installPath,
        version,
        installedAt,
      },
    };
  }

  return {
    pluginId,
    record: {
      source: 'npm',
      spec: definition.npmName,
      installPath,
      version,
      resolvedName: definition.npmName,
      resolvedVersion: version,
      resolvedSpec: `${definition.npmName}@${version}`,
      installedAt,
    },
  };
}

function pluginInstallRecordIds(pluginDirName: string): string[] {
  const definition = TRUSTED_OFFICIAL_EXTENSION_PLUGINS[pluginDirName];
  return [...new Set([
    pluginDirName,
    definition?.pluginId,
    ...(definition?.legacyPluginIds ?? []),
  ].filter((value): value is string => Boolean(value)))];
}

function removeLegacyPluginInstallMetadataFromConfig(pluginIds: string[]): boolean {
  if (!existsSync(fsPath(OPENCLAW_CONFIG_PATH))) return false;

  const raw = readFileSync(fsPath(OPENCLAW_CONFIG_PATH), 'utf-8');
  const config = JSON.parse(raw) as Record<string, unknown>;
  const plugins = config.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return false;
  const pluginsRecord = plugins as Record<string, unknown>;
  const installs = pluginsRecord.installs;
  if (!installs || typeof installs !== 'object' || Array.isArray(installs)) return false;

  const installsRecord = installs as Record<string, unknown>;
  const removedIds = pluginIds.filter((pluginId) => Object.hasOwn(installsRecord, pluginId));
  if (removedIds.length === 0) return false;
  for (const pluginId of removedIds) {
    delete installsRecord[pluginId];
  }
  if (Object.keys(installsRecord).length === 0) {
    delete pluginsRecord.installs;
  }
  writeFileSync(
    fsPath(OPENCLAW_CONFIG_PATH),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf-8',
  );
  logger.info(`[plugin] Removed legacy config install metadata for: ${removedIds.join(', ')}`);
  return true;
}

function canonicalComparablePath(filePath: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(fsPath(filePath));
  } catch {
    resolved = path.resolve(filePath);
  }
  const withoutLongPathPrefix = resolved.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/i, '');
  return process.platform === 'win32' ? withoutLongPathPrefix.toLowerCase() : withoutLongPathPrefix;
}

/**
 * Materialized mirrors live outside the bundled OpenClaw package tree, so
 * Node's normal package lookup cannot resolve their declared `openclaw` peer.
 * OpenClaw 2026.7.1 also audits this exact link before reporting Gateway ready.
 */
export function repairPluginOpenClawPeerLink(
  targetDir: string,
  openclawDir = getOpenClawResolvedDir(),
): boolean {
  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(readFileSync(fsPath(join(targetDir, 'package.json')), 'utf-8')) as Record<string, unknown>;
  } catch {
    return false;
  }

  const peerDependencies = packageJson.peerDependencies;
  if (
    !peerDependencies
    || typeof peerDependencies !== 'object'
    || Array.isArray(peerDependencies)
    || typeof (peerDependencies as Record<string, unknown>).openclaw !== 'string'
  ) {
    return true;
  }

  if (!existsSync(fsPath(join(openclawDir, 'package.json')))) {
    logger.warn(`[plugin] Cannot link OpenClaw peer for ${targetDir}: runtime package missing at ${openclawDir}`);
    return false;
  }

  const nodeModulesDir = join(targetDir, 'node_modules');
  const linkPath = join(nodeModulesDir, 'openclaw');
  try {
    mkdirSync(fsPath(nodeModulesDir), { recursive: true });
    const nodeModulesStat = lstatSync(fsPath(nodeModulesDir));
    if (!nodeModulesStat.isDirectory() || nodeModulesStat.isSymbolicLink()) {
      logger.warn(`[plugin] Cannot link OpenClaw peer because ${nodeModulesDir} is not a real directory`);
      return false;
    }

    try {
      if (canonicalComparablePath(linkPath) === canonicalComparablePath(openclawDir)) {
        return true;
      }
    } catch {
      // Fall through to lstat/creation for a missing or broken link.
    }

    let existing: ReturnType<typeof lstatSync> | null = null;
    try {
      existing = lstatSync(fsPath(linkPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing) {
      if (existing.isSymbolicLink()) {
        unlinkSync(fsPath(linkPath));
      } else if (existing.isDirectory()) {
        let existingPackageName: unknown;
        try {
          existingPackageName = JSON.parse(
            readFileSync(fsPath(join(linkPath, 'package.json')), 'utf-8'),
          ).name;
        } catch {
          existingPackageName = null;
        }
        if (existingPackageName !== 'openclaw') {
          logger.warn(`[plugin] Cannot replace non-OpenClaw peer directory at ${linkPath}`);
          return false;
        }
        rmSync(fsPath(linkPath), { recursive: true, force: true });
      } else {
        logger.warn(`[plugin] Cannot replace non-directory OpenClaw peer at ${linkPath}`);
        return false;
      }
    }

    symlinkSync(openclawDir, fsPath(linkPath), 'junction');
    if (canonicalComparablePath(linkPath) !== canonicalComparablePath(openclawDir)) {
      logger.warn(`[plugin] OpenClaw peer link audit failed after creating ${linkPath}`);
      return false;
    }
    logger.info(`[plugin] Linked OpenClaw peer: ${linkPath} → ${openclawDir}`);
    return true;
  } catch (error) {
    logger.warn(`[plugin] Failed to link OpenClaw peer for ${targetDir}:`, error);
    return false;
  }
}

function persistTrustedOfficialPluginInstallRecordsToSqlite(
  records: Record<string, Record<string, unknown>>,
): boolean {
  return upsertPluginInstallRecordsIntoSqlite(records);
}

/**
 * Persist a ClawX-mirrored plugin install record in OpenClaw's canonical SQLite
 * index. OpenClaw 2026.7.1 treats config-level plugins.installs as legacy
 * migration input, so remove that transient copy instead of recreating it.
 * Safe to call repeatedly; no-ops when metadata is already current.
 */
export function syncTrustedOfficialPluginInstallRecord(
  pluginDirName: string,
  targetDir: string,
): boolean {
  const expected = buildTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
  if (!expected) return false;

  if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
    return false;
  }

  // Repair this even when install metadata already matches. A copied plugin's
  // node_modules intentionally excludes host peers, and OpenClaw's migration
  // smoke check runs before the Gateway can supply any runtime fallback.
  repairPluginOpenClawPeerLink(targetDir);

  const recordIds = pluginInstallRecordIds(pluginDirName);
  let jsonChanged = false;
  try {
    ensureOpenClawStateDirExists();
    jsonChanged = removeLegacyPluginInstallMetadataFromConfig(recordIds);
  } catch (error) {
    // Keep the canonical SQLite repair available even if legacy config cleanup
    // cannot be completed in this pass.
    logger.warn(`[plugin] Failed to remove legacy install metadata for ${pluginDirName}:`, error);
  }

  // Remove aliases left by older ClawX/OpenClaw ownership conventions, but do
  // not delete the canonical id first: upsert can replace npm/path ownership
  // atomically without creating a missing-record window.
  const staleRecordIds = recordIds.filter((pluginId) => pluginId !== expected.pluginId);
  const removedLegacyRecord = removePluginInstallRecordsFromSqlite(staleRecordIds);
  const sqliteChanged = persistTrustedOfficialPluginInstallRecordsToSqlite({
    [expected.pluginId]: expected.record,
  });
  return jsonChanged || removedLegacyRecord || sqliteChanged;
}

/**
 * Remove metadata for a ClawX mirror that is no longer configured. This must
 * run even when its extension directory is already missing: stale records are
 * themselves enough to fail OpenClaw's post-core payload smoke check.
 */
export function removeTrustedOfficialPluginInstallRecord(pluginDirName: string): boolean {
  const recordIds = pluginInstallRecordIds(pluginDirName);
  if (recordIds.length === 0) return false;

  let jsonChanged = false;
  try {
    jsonChanged = removeLegacyPluginInstallMetadataFromConfig(recordIds);
  } catch (error) {
    logger.warn(`[plugin] Failed to remove stale config install metadata for ${pluginDirName}:`, error);
  }
  const sqliteChanged = removePluginInstallRecordsFromSqlite(recordIds);
  return jsonChanged || sqliteChanged;
}

/** Repair managed install metadata and host peer links for all mirrors on disk. */
export function repairTrustedOfficialPluginInstallRecords(): void {
  for (const pluginDirName of Object.keys(TRUSTED_OFFICIAL_EXTENSION_PLUGINS)) {
    const targetDir = join(homedir(), '.openclaw', 'extensions', pluginDirName);
    if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
      continue;
    }
    syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
  }
}

export function resolvePluginNpmPackagePath(npmName: string): string | null {
  const candidateRoots = app.isPackaged
    ? [app.getAppPath(), process.resourcesPath]
    : [app.getAppPath(), process.cwd(), join(app.getAppPath(), '..')];

  for (const root of candidateRoots) {
    const npmPkgPath = join(root, 'node_modules', ...npmName.split('/'));
    if (existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) {
      return npmPkgPath;
    }
  }

  return null;
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

// ── pnpm-aware node_modules copy helpers ─────────────────────────────────────

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
  if (!existsSync(fsPath(nodeModulesDir))) return result;
  const SKIP = new Set(['.bin', '.package-lock.json', '.modules.yaml', '.pnpm']);
  for (const entry of readdirSync(fsPath(nodeModulesDir), { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP.has(entry.name)) continue;
    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      try {
        for (const sub of readdirSync(fsPath(entryPath))) {
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
export function copyPluginFromNodeModules(npmPkgPath: string, targetDir: string, npmName: string): void {
  let realPath: string;
  try {
    realPath = realpathSync(fsPath(npmPkgPath));
  } catch {
    throw new Error(`Cannot resolve real path for ${npmPkgPath}`);
  }

  // 1. Copy plugin package itself
  rmSync(fsPath(targetDir), { recursive: true, force: true });
  mkdirSync(fsPath(targetDir), { recursive: true });
  cpSyncSafe(realPath, targetDir);

  // 2. Collect transitive deps from pnpm virtual store
  const rootVirtualNM = findParentNodeModules(realPath);
  if (!rootVirtualNM) {
    logger.warn(`[plugin] Cannot find virtual store node_modules for ${npmName}, plugin may lack deps`);
    return;
  }

  // Read peer deps to skip (they're provided by the host gateway)
  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  try {
    const pluginPkg = JSON.parse(readFileSync(fsPath(join(targetDir, 'package.json')), 'utf-8'));
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
        depRealPath = realpathSync(fsPath(fullPath));
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
  mkdirSync(fsPath(outputNM), { recursive: true });
  const copiedNames = new Set<string>();
  for (const [depRealPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);
    const dest = join(outputNM, pkgName);
    try {
      mkdirSync(fsPath(path.dirname(dest)), { recursive: true });
      cpSyncSafe(depRealPath, dest);
    } catch { /* skip individual dep failures */ }
  }

  logger.info(`[plugin] Copied ${copiedNames.size} deps for ${npmName}`);
}

// ── Core install / upgrade logic ─────────────────────────────────────────────

export function ensurePluginInstalled(
  pluginDirName: string,
  candidateSources: string[],
  pluginLabel: string,
): { installed: boolean; warning?: string } {
  const targetDir = join(homedir(), '.openclaw', 'extensions', pluginDirName);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPkgJson = join(targetDir, 'package.json');

  const sourceDir = candidateSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

  // If already installed, check whether an upgrade is available
  if (existsSync(fsPath(targetManifest))) {
    if (!sourceDir) {
      syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
      return { installed: true }; // no bundled source to compare, keep existing
    }
    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) {
      syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
      return { installed: true }; // same version or unable to compare
    }
    // Version differs — fall through to overwrite install
    logger.info(
      `[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion}`,
    );
  }

  // Fresh install or upgrade — try bundled/build sources first
  if (sourceDir) {
    const extensionsRoot = join(homedir(), '.openclaw', 'extensions');
    const attempts: Array<{ attempt: number; code?: string; name?: string; message: string }> = [];
    const maxAttempts = process.platform === 'win32' ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        mkdirSync(fsPath(extensionsRoot), { recursive: true });
        rmSync(fsPath(targetDir), { recursive: true, force: true });
        cpSyncSafe(sourceDir, targetDir);
        if (!existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
          return { installed: false, warning: `Failed to install ${pluginLabel} plugin mirror (manifest missing).` };
        }
        fixupPluginManifest(targetDir);
        syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
        logger.info(`Installed ${pluginLabel} plugin from bundled mirror: ${sourceDir}`);
        return { installed: true };
      } catch (error) {
        const diagnostic = toErrorDiagnostic(error);
        attempts.push({ attempt, ...diagnostic });
        if (attempt < maxAttempts) {
          try {
            rmSync(fsPath(targetDir), { recursive: true, force: true });
          } catch {
            // Ignore cleanup failures before retry.
          }
        }
      }
    }

    logger.warn(
      `[plugin] Bundled mirror install failed for ${pluginLabel}`,
      {
        pluginDirName,
        pluginLabel,
        sourceDir,
        targetDir,
        platform: process.platform,
        attempts,
      },
    );

    return { installed: false, warning: `Failed to install bundled ${pluginLabel} plugin mirror` };
  }

  // Dev mode fallback: copy from node_modules with pnpm-aware dep resolution
  if (!app.isPackaged) {
    const npmName = PLUGIN_NPM_NAMES[pluginDirName];
    if (npmName) {
      const npmPkgPath = resolvePluginNpmPackagePath(npmName);
      if (npmPkgPath && existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) {
        const installedVersion = existsSync(fsPath(targetPkgJson)) ? readPluginVersion(targetPkgJson) : null;
        const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
        if (sourceVersion && (!installedVersion || sourceVersion !== installedVersion)) {
          logger.info(
            `[plugin] ${installedVersion ? 'Upgrading' : 'Installing'} ${pluginLabel} plugin` +
            `${installedVersion ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`,
          );
          try {
            mkdirSync(fsPath(join(homedir(), '.openclaw', 'extensions')), { recursive: true });
            copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
            fixupPluginManifest(targetDir);
            if (existsSync(fsPath(join(targetDir, 'openclaw.plugin.json')))) {
              syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
              return { installed: true };
            }
          } catch (err) {
            logger.warn(
              `[plugin] Failed to install ${pluginLabel} plugin from node_modules`,
              {
                pluginDirName,
                pluginLabel,
                npmName,
                npmPkgPath,
                targetDir,
                platform: process.platform,
                ...toErrorDiagnostic(err),
              },
            );
          }
        } else if (existsSync(fsPath(targetManifest))) {
          syncTrustedOfficialPluginInstallRecord(pluginDirName, targetDir);
          return { installed: true }; // same version, already installed
        }
      }
    }
  }

  return {
    installed: false,
    warning: `Bundled ${pluginLabel} plugin mirror not found. Checked: ${candidateSources.join(' | ')}`,
  };
}

// ── Candidate source path builder ────────────────────────────────────────────

export function buildCandidateSources(pluginDirName: string): string[] {
  return app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'resources', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(app.getAppPath(), 'resources', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'resources', 'openclaw-plugins', pluginDirName),
      join(__dirname, '../../build/openclaw-plugins', pluginDirName),
      join(__dirname, '../../resources/openclaw-plugins', pluginDirName),
    ];
}

// ── Per-channel plugin helpers ───────────────────────────────────────────────

export function ensureDingTalkPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('dingtalk', buildCandidateSources('dingtalk'), 'DingTalk');
}

export function ensureWeComPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('wecom', buildCandidateSources('wecom'), 'WeCom');
}

export function ensureFeishuPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'feishu-openclaw-plugin',
    buildCandidateSources('feishu-openclaw-plugin'),
    'Feishu',
  );
}



export function ensureWeChatPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('openclaw-weixin', buildCandidateSources('openclaw-weixin'), 'WeChat');
}

export function ensureDiscordPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('discord', buildCandidateSources('discord'), 'Discord');
}

export function ensureQQBotPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('qqbot', buildCandidateSources('qqbot'), 'QQBot');
}

export function ensureWhatsAppPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled('whatsapp', buildCandidateSources('whatsapp'), 'WhatsApp');
}

export function ensureClawXOpenAiImagePluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'clawx-openai-image',
    buildCandidateSources('clawx-openai-image'),
    'ClawX OpenAI Image',
  );
}

// ── Bulk startup installer ───────────────────────────────────────────────────

/**
 * All bundled plugins, in the same order as after-pack.cjs BUNDLED_PLUGINS.
 */
const ALL_BUNDLED_PLUGINS = [
  { fn: ensureDingTalkPluginInstalled, label: 'DingTalk' },
  { fn: ensureWeComPluginInstalled, label: 'WeCom' },

  { fn: ensureFeishuPluginInstalled, label: 'Feishu' },
  { fn: ensureWeChatPluginInstalled, label: 'WeChat' },
  { fn: ensureDiscordPluginInstalled, label: 'Discord' },
  { fn: ensureQQBotPluginInstalled, label: 'QQBot' },
  { fn: ensureWhatsAppPluginInstalled, label: 'WhatsApp' },
  { fn: ensureClawXOpenAiImagePluginInstalled, label: 'ClawX OpenAI Image' },
] as const;

/**
 * Ensure all bundled OpenClaw plugins are installed/upgraded in
 * `~/.openclaw/extensions/`.  Designed to be called once at app startup
 * as a fire-and-forget task — errors are logged but never thrown.
 */
export async function ensureAllBundledPluginsInstalled(): Promise<void> {
  for (const { fn, label } of ALL_BUNDLED_PLUGINS) {
    try {
      const result = fn();
      if (result.warning) {
        logger.warn(`[plugin] ${label}: ${result.warning}`);
      }
    } catch (error) {
      logger.warn(`[plugin] Failed to install/upgrade ${label} plugin:`, error);
    }
  }
  repairTrustedOfficialPluginInstallRecords();
}

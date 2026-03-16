import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'fs';
import path, { join } from 'path';
import { logger } from './logger';
import { getOpenClawExtensionsDir } from './paths';

export interface ChannelPluginInstallOptions {
  pluginDirName: string;
  pluginLabel: string;
  npmName: string;
}

export interface ChannelPluginInstallResult {
  installed: boolean;
  warning?: string;
}

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(pkgJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function findParentNodeModules(startPath: string): string | null {
  let dir = startPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function listPackagesInDir(nodeModulesDir: string): Array<{ name: string; fullPath: string }> {
  const result: Array<{ name: string; fullPath: string }> = [];
  if (!existsSync(nodeModulesDir)) return result;

  const skip = new Set(['.bin', '.package-lock.json', '.modules.yaml', '.pnpm']);
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (skip.has(entry.name)) continue;

    const entryPath = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      try {
        for (const sub of readdirSync(entryPath)) {
          result.push({ name: `${entry.name}/${sub}`, fullPath: join(entryPath, sub) });
        }
      } catch {
        // ignore unreadable scoped dirs
      }
      continue;
    }

    result.push({ name: entry.name, fullPath: entryPath });
  }

  return result;
}

function copyPluginFromNodeModules(npmPkgPath: string, targetDir: string, npmName: string): void {
  let realPath: string;
  try {
    realPath = realpathSync(npmPkgPath);
  } catch {
    throw new Error(`Cannot resolve real path for ${npmPkgPath}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(realPath, targetDir, { recursive: true, dereference: true });

  const rootVirtualNodeModules = findParentNodeModules(realPath);
  if (!rootVirtualNodeModules) {
    logger.warn(`[plugin] Cannot find virtual store node_modules for ${npmName}, plugin may lack deps`);
    return;
  }

  const skipPackages = new Set(['typescript', '@playwright/test']);
  try {
    const pluginPkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8')) as {
      peerDependencies?: Record<string, string>;
    };
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      skipPackages.add(peer);
    }
  } catch {
    // ignore malformed package metadata
  }

  const collected = new Map<string, string>();
  const queue: Array<{ nodeModulesDir: string; skipPkg: string }> = [
    { nodeModulesDir: rootVirtualNodeModules, skipPkg: npmName },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;

    for (const { name, fullPath } of listPackagesInDir(next.nodeModulesDir)) {
      if (name === next.skipPkg) continue;
      if (skipPackages.has(name) || name.startsWith('@types/')) continue;

      let depRealPath: string;
      try {
        depRealPath = realpathSync(fullPath);
      } catch {
        continue;
      }
      if (collected.has(depRealPath)) continue;

      collected.set(depRealPath, name);
      const depVirtualNodeModules = findParentNodeModules(depRealPath);
      if (depVirtualNodeModules && depVirtualNodeModules !== next.nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNodeModules, skipPkg: name });
      }
    }
  }

  const outputNodeModules = join(targetDir, 'node_modules');
  mkdirSync(outputNodeModules, { recursive: true });

  const copiedNames = new Set<string>();
  for (const [depRealPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) continue;
    copiedNames.add(pkgName);

    const dest = join(outputNodeModules, pkgName);
    try {
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(depRealPath, dest, { recursive: true, dereference: true });
    } catch {
      // skip individual dependency copy failures
    }
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
      join(__dirname, '../../build/openclaw-plugins', pluginDirName),
    ];
}

function resolveDevPackageSource(npmName: string): string | null {
  if (app.isPackaged) {
    return null;
  }

  const sourceDir = join(process.cwd(), 'node_modules', ...npmName.split('/'));
  if (!existsSync(join(sourceDir, 'openclaw.plugin.json'))) {
    return null;
  }

  return sourceDir;
}

export function ensureChannelPluginInstalled(
  options: ChannelPluginInstallOptions,
): ChannelPluginInstallResult {
  const { pluginDirName, pluginLabel, npmName } = options;
  const extensionsDir = getOpenClawExtensionsDir();
  const targetDir = join(extensionsDir, pluginDirName);
  const targetManifest = join(targetDir, 'openclaw.plugin.json');
  const targetPkgJson = join(targetDir, 'package.json');

  const bundledSources = buildBundledPluginSources(pluginDirName);
  const bundledSourceDir = bundledSources.find((dir) => existsSync(join(dir, 'openclaw.plugin.json')));
  const devPackageSourceDir = resolveDevPackageSource(npmName);
  const sourceDir = bundledSourceDir ?? devPackageSourceDir;
  const sourceLabel = bundledSourceDir ? 'bundled mirror' : 'node_modules';

  if (existsSync(targetManifest)) {
    if (!sourceDir) return { installed: true };

    const installedVersion = readPluginVersion(targetPkgJson);
    const sourceVersion = readPluginVersion(join(sourceDir, 'package.json'));
    if (!sourceVersion || !installedVersion || sourceVersion === installedVersion) {
      return { installed: true };
    }

    logger.info(`[plugin] Upgrading ${pluginLabel} plugin: ${installedVersion} → ${sourceVersion} (${sourceLabel})`);
  }

  if (!sourceDir) {
    const checkedSources = [...bundledSources, join(process.cwd(), 'node_modules', ...npmName.split('/'))];
    logger.warn(`${pluginLabel} plugin source not found in candidate paths`, { checkedSources });
    return {
      installed: false,
      warning: `${pluginLabel} plugin source not found. Checked: ${checkedSources.join(' | ')}`,
    };
  }

  try {
    mkdirSync(extensionsDir, { recursive: true });
    if (bundledSourceDir) {
      rmSync(targetDir, { recursive: true, force: true });
      cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    } else {
      copyPluginFromNodeModules(sourceDir, targetDir, npmName);
    }

    if (!existsSync(join(targetDir, 'openclaw.plugin.json'))) {
      return { installed: false, warning: `Failed to install ${pluginLabel} plugin (manifest missing).` };
    }

    logger.info(`Installed ${pluginLabel} plugin from ${sourceLabel}: ${sourceDir}`);
    return { installed: true };
  } catch (error) {
    logger.warn(`Failed to install ${pluginLabel} plugin from ${sourceLabel}:`, error);
    return {
      installed: false,
      warning: `Failed to install ${pluginLabel} plugin from ${sourceLabel}`,
    };
  }
}

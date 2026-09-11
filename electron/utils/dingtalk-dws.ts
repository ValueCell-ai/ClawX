/**
 * Provision the official DingTalk workspace CLI (`dws`) so plugin skills
 * such as `dws-cli` can execute calendar/doc commands.
 *
 * The npm package's postinstall extracts `vendor/dws` from `assets/`.
 * pnpm may ignore that script, so ClawX extracts the binary itself and
 * never copies dws skills into every agent home directory.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { app } from 'electron';
import { logger } from './logger';
import { safeRmSync } from './safe-fs';

export const DINGTALK_DWS_NPM = 'dingtalk-workspace-cli';
export const DINGTALK_DWS_VERSION = '1.0.30';
export const DINGTALK_DWS_MISSING = 'dingtalk_dws_missing';
export const DINGTALK_DWS_AUTH_REQUIRED = 'dingtalk_dws_auth_required';

export type DingTalkDwsAuthState = 'authorized' | 'needs_auth' | 'unavailable';

const DWS_PLATFORM_ARCHIVES: Record<string, string> = {
  'darwin-x64': 'dws-darwin-amd64.tar.gz',
  'darwin-arm64': 'dws-darwin-arm64.tar.gz',
  'linux-x64': 'dws-linux-amd64.tar.gz',
  'linux-arm64': 'dws-linux-arm64.tar.gz',
  'win32-x64': 'dws-windows-amd64.zip',
  'win32-arm64': 'dws-windows-arm64.zip',
};

const STATUS_CACHE_MS = 30_000;
let statusNoteCache: { at: number; note?: string } | null = null;

export function getDingTalkDwsInstallDir(): string {
  return join(homedir(), '.openclaw', 'tools', 'dingtalk-workspace-cli');
}

export function getDingTalkDwsBinDir(): string {
  return join(getDingTalkDwsInstallDir(), 'bin');
}

function vendorBinaryName(platform = process.platform): string {
  return platform === 'win32' ? 'dws.exe' : 'dws';
}

function hasDwsWrapper(packageDir: string): boolean {
  return existsSync(join(packageDir, 'bin', 'dws'))
    || existsSync(join(packageDir, 'bin', 'dws.js'));
}

function hasDwsVendorBinary(packageDir: string, platform = process.platform): boolean {
  return existsSync(join(packageDir, 'vendor', vendorBinaryName(platform)));
}

function findDwsBinary(root: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.name === 'dws' || entry.name === 'dws.exe') {
        return entryPath;
      }
    }
  }
  return null;
}

export function extractDingTalkDwsVendor(
  packageDir: string,
  platform = process.platform,
  arch = process.arch,
): boolean {
  const vendorDir = join(packageDir, 'vendor');
  const vendorBin = join(vendorDir, vendorBinaryName(platform));
  if (existsSync(vendorBin)) return true;

  const archiveName = DWS_PLATFORM_ARCHIVES[`${platform}-${arch}`];
  if (!archiveName) {
    logger.warn(`[plugin] Unsupported DingTalk workspace CLI platform: ${platform}-${arch}`);
    return false;
  }
  const archivePath = join(packageDir, 'assets', archiveName);
  if (!existsSync(archivePath)) {
    logger.warn(`[plugin] Missing DingTalk workspace CLI archive: ${archivePath}`);
    return false;
  }

  const tmpDir = join(packageDir, '.dws-extract-tmp');
  try {
    safeRmSync(tmpDir);
    mkdirSync(tmpDir, { recursive: true });
    if (archivePath.endsWith('.tar.gz')) {
      execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir], { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execFileSync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('unzip', ['-q', archivePath, '-d', tmpDir], { stdio: 'ignore' });
    }

    const found = findDwsBinary(tmpDir);
    if (!found) {
      logger.warn('[plugin] DingTalk workspace CLI archive did not contain a dws binary');
      return false;
    }
    mkdirSync(vendorDir, { recursive: true });
    cpSync(found, vendorBin);
    if (platform !== 'win32') {
      chmodSync(vendorBin, 0o755);
    }
    return existsSync(vendorBin);
  } catch (error) {
    logger.warn('[plugin] Failed to extract DingTalk workspace CLI binary:', error);
    return false;
  } finally {
    safeRmSync(tmpDir);
  }
}

function readPackageName(pkgPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return parsed.name ?? null;
  } catch {
    return null;
  }
}

function candidateDwsSources(): string[] {
  const roots = app.isPackaged
    ? [
      join(process.resourcesPath, 'dingtalk-dws'),
      join(process.resourcesPath, 'resources', 'dingtalk-dws'),
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', DINGTALK_DWS_NPM),
    ]
    : [
      join(process.cwd(), 'node_modules', DINGTALK_DWS_NPM),
      join(app.getAppPath(), 'node_modules', DINGTALK_DWS_NPM),
      join(__dirname, '../../node_modules', DINGTALK_DWS_NPM),
    ];
  return roots;
}

function resolveDwsSourceDir(): string | null {
  for (const candidate of candidateDwsSources()) {
    if (existsSync(join(candidate, 'package.json')) && readPackageName(join(candidate, 'package.json')) === DINGTALK_DWS_NPM) {
      return candidate;
    }
  }
  return null;
}

function resolveDwsPackageDir(): string | null {
  const installed = getDingTalkDwsInstallDir();
  if (hasDwsWrapper(installed) && hasDwsVendorBinary(installed)) {
    return installed;
  }
  const sourceDir = resolveDwsSourceDir();
  if (sourceDir && hasDwsWrapper(sourceDir) && hasDwsVendorBinary(sourceDir)) {
    return sourceDir;
  }
  return null;
}

export function resolveDingTalkDwsBinDir(): string | null {
  const packageDir = resolveDwsPackageDir();
  return packageDir ? join(packageDir, 'bin') : null;
}

export function isDingTalkDwsAvailable(): boolean {
  return resolveDingTalkDwsBinDir() != null;
}

export function probeDingTalkDwsAuth(): DingTalkDwsAuthState {
  const packageDir = resolveDwsPackageDir();
  if (!packageDir) return 'unavailable';
  const vendorBin = join(packageDir, 'vendor', vendorBinaryName());
  if (!existsSync(vendorBin)) return 'unavailable';

  try {
    const output = execFileSync(vendorBin, ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 8000,
      env: {
        ...process.env,
        PATH: `${join(packageDir, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as { authenticated?: boolean };
    return parsed.authenticated === true ? 'authorized' : 'needs_auth';
  } catch {
    return 'needs_auth';
  }
}

export function getDingTalkDwsStatusNote(): string | undefined {
  if (statusNoteCache && Date.now() - statusNoteCache.at < STATUS_CACHE_MS) {
    return statusNoteCache.note;
  }
  const note = !isDingTalkDwsAvailable()
    ? DINGTALK_DWS_MISSING
    : probeDingTalkDwsAuth() === 'authorized'
      ? undefined
      : DINGTALK_DWS_AUTH_REQUIRED;
  statusNoteCache = { at: Date.now(), note };
  return note;
}

export function refreshDingTalkDwsStatusNote(): string | undefined {
  statusNoteCache = null;
  return getDingTalkDwsStatusNote();
}

export function resetDingTalkDwsStatusCacheForTests(): void {
  statusNoteCache = null;
}

export function ensureDingTalkDwsInstalled(): { installed: boolean; warning?: string } {
  const sourceDir = resolveDwsSourceDir();
  if (!sourceDir) {
    refreshDingTalkDwsStatusNote();
    return { installed: false, warning: DINGTALK_DWS_MISSING };
  }

  const targetDir = getDingTalkDwsInstallDir();
  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    safeRmSync(targetDir);
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
    if (!extractDingTalkDwsVendor(targetDir) || !isDingTalkDwsAvailable()) {
      refreshDingTalkDwsStatusNote();
      return { installed: false, warning: DINGTALK_DWS_MISSING };
    }
    logger.info(`[plugin] Installed DingTalk workspace CLI ${DINGTALK_DWS_VERSION} at ${targetDir}`);
    const auth = probeDingTalkDwsAuth();
    refreshDingTalkDwsStatusNote();
    if (auth !== 'authorized') {
      // Official connector injects DWS_CLIENT_ID / DWS_CLIENT_SECRET at spawn
      // time. Device login is interactive and must not block channel save.
      return { installed: true, warning: DINGTALK_DWS_AUTH_REQUIRED };
    }
    return { installed: true };
  } catch (error) {
    logger.warn('[plugin] Failed to install DingTalk workspace CLI:', error);
    refreshDingTalkDwsStatusNote();
    return { installed: false, warning: DINGTALK_DWS_MISSING };
  }
}

export function removeLegacyOfficialDingTalkExtension(): void {
  const leftover = join(homedir(), '.openclaw', 'extensions', 'dingtalk-connector');
  if (!existsSync(leftover)) return;
  try {
    safeRmSync(leftover);
    logger.info('[plugin] Removed leftover official DingTalk extension at ~/.openclaw/extensions/dingtalk-connector');
  } catch (error) {
    logger.warn('[plugin] Failed to remove leftover dingtalk-connector extension:', error);
  }
}

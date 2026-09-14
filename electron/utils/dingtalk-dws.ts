/**
 * Provision the official DingTalk workspace CLI (`dws`) so plugin skills
 * such as `dws-cli` can execute calendar/doc commands.
 *
 * The npm package's postinstall extracts `vendor/dws` from `assets/`.
 * pnpm may ignore that script, so ClawX extracts the binary itself and
 * never copies dws skills into every agent home directory.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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
export type DingTalkDwsOAuthState = DingTalkDwsAuthState | 'starting' | 'pending' | 'error';

export type DingTalkDwsOAuthSnapshot = {
  status: DingTalkDwsOAuthState;
  verificationUri?: string;
  verificationUriComplete?: string;
  userCode?: string;
  expiresAt?: number;
  error?: string;
};

export type DingTalkDwsOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

const DWS_PLATFORM_ARCHIVES: Record<string, string> = {
  'darwin-x64': 'dws-darwin-amd64.tar.gz',
  'darwin-arm64': 'dws-darwin-arm64.tar.gz',
  'linux-x64': 'dws-linux-amd64.tar.gz',
  'linux-arm64': 'dws-linux-arm64.tar.gz',
  'win32-x64': 'dws-windows-amd64.zip',
  'win32-arm64': 'dws-windows-arm64.zip',
};

const STATUS_CACHE_MS = 30_000;
const OAUTH_START_WAIT_MS = 20_000;
const DEVICE_AUTH_FALLBACK_EXPIRES_SECONDS = 900;
const LOOPBACK_AUTH_FALLBACK_EXPIRES_SECONDS = 600;
const DEVICE_AUTH_EXIT_GRACE_MS = 1_500;
const DEVICE_AUTH_OUTPUT_LIMIT = 32 * 1024;
let statusNoteCache: { at: number; note?: string } | null = null;
let activeOAuthProcess: ChildProcess | null = null;
let activeOAuthSnapshot: DingTalkDwsOAuthSnapshot | null = null;
let activeOAuthStartResolver: ((snapshot: DingTalkDwsOAuthSnapshot) => void) | null = null;
let activeOAuthExpiryTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (app.isPackaged) {
    return [
      join(process.resourcesPath, 'dingtalk-dws'),
      join(process.resourcesPath, 'resources', 'dingtalk-dws'),
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', DINGTALK_DWS_NPM),
    ];
  }

  const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : null;
  return [
    join(process.cwd(), 'node_modules', DINGTALK_DWS_NPM),
    ...(appPath ? [join(appPath, 'node_modules', DINGTALK_DWS_NPM)] : []),
    join(__dirname, '../../node_modules', DINGTALK_DWS_NPM),
  ];
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

function resolveDwsExecutable(): { packageDir: string; executable: string } | null {
  const packageDir = resolveDwsPackageDir();
  if (!packageDir) return null;
  const executable = join(packageDir, 'vendor', vendorBinaryName());
  return existsSync(executable) ? { packageDir, executable } : null;
}

function buildDwsEnv(
  packageDir: string,
  credentials?: DingTalkDwsOAuthCredentials,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${join(packageDir, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    DINGTALK_AGENT: 'DING_DWS_CLAW',
    ...(credentials?.clientId ? { DWS_CLIENT_ID: credentials.clientId } : {}),
    ...(credentials?.clientSecret ? { DWS_CLIENT_SECRET: credentials.clientSecret } : {}),
  };
}

export function probeDingTalkDwsAuth(credentials?: DingTalkDwsOAuthCredentials): DingTalkDwsAuthState {
  const resolved = resolveDwsExecutable();
  if (!resolved) return 'unavailable';

  try {
    const output = execFileSync(resolved.executable, ['auth', 'status', '--format', 'json'], {
      encoding: 'utf8',
      timeout: 8000,
      env: buildDwsEnv(resolved.packageDir, credentials),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as { authenticated?: boolean };
    return parsed.authenticated === true ? 'authorized' : 'needs_auth';
  } catch {
    return 'needs_auth';
  }
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function classifyDingTalkDwsOAuthError(output: string): string {
  const normalized = stripAnsi(output).toLowerCase();
  if (/user_not_allowed|user not allowed|用户不在.*范围|不在应用.*范围/.test(normalized)) {
    return 'authorization_user_not_allowed';
  }
  if (/access_denied|authorization_denied|拒绝授权|取消授权|用户取消/.test(normalized)) {
    return 'authorization_denied';
  }
  if (/invalid_client|invalid client|client[_ ]?secret.*(?:invalid|incorrect)|appkey.*(?:invalid|不存在)/.test(normalized)) {
    return 'authorization_invalid_client';
  }
  if (/尚未开启.*cli.*数据访问权限|未开启.*允许成员通过.*cli|cli.*access.*(?:disabled|not enabled)/.test(normalized)) {
    return 'authorization_org_cli_disabled';
  }
  if (/permission[_ ]?denied|forbidden|missing.*scope|scope.*(?:missing|invalid)|权限不足|缺少.*权限/.test(normalized)) {
    return 'authorization_permission_denied';
  }
  if (/network_error|network is unreachable|connection (?:refused|reset)|i\/o timeout|context deadline exceeded|网络.*(?:失败|异常|不可用)/.test(normalized)) {
    return 'authorization_network_error';
  }
  if (/expired_token|device code.*expired|授权码.*过期/.test(normalized)) {
    return 'authorization_expired';
  }
  return 'authorization_failed';
}

export function parseDingTalkDwsDeviceOutput(output: string): DingTalkDwsOAuthSnapshot | null {
  const clean = stripAnsi(output);
  const urls = clean.match(/https?:\/\/[^\s│]+/g) ?? [];
  const verificationUriComplete = urls.find((url) => /[?&]user_code=/i.test(url));
  const verificationUri = urls.find((url) => !/[?&]user_code=/i.test(url))
    ?? verificationUriComplete?.replace(/\?user_code=.*$/i, '');
  const encodedCode = verificationUriComplete?.match(/[?&]user_code=([^&#\s]+)/i)?.[1];
  const displayedCode = clean.match(/(?:授权码|user[_ ]?code)\s*[:：]\s*([A-Z0-9-]+)/i)?.[1];
  const userCode = encodedCode ? decodeURIComponent(encodedCode) : displayedCode;
  if (!verificationUri || !userCode) return null;

  const expiresSeconds = Number(clean.match(/(?:将在|expires?\s+in)\s*(\d+)\s*(?:秒|seconds?)/i)?.[1]);
  const expiresIn = Number.isFinite(expiresSeconds) && expiresSeconds > 0
    ? expiresSeconds
    : DEVICE_AUTH_FALLBACK_EXPIRES_SECONDS;
  return {
    status: 'pending',
    verificationUri,
    verificationUriComplete: verificationUriComplete ?? `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    userCode,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export function parseDingTalkDwsLoginOutput(output: string): DingTalkDwsOAuthSnapshot | null {
  const deviceFlow = parseDingTalkDwsDeviceOutput(output);
  if (deviceFlow) return deviceFlow;

  const clean = stripAnsi(output);
  const authorizationUrl = (clean.match(/https?:\/\/[^\s│]+/g) ?? [])
    .find((url) => /login\.dingtalk\.com\/oauth2\/auth(?:\?|$)/i.test(url));
  if (!authorizationUrl) return null;
  return {
    status: 'pending',
    verificationUriComplete: authorizationUrl,
    expiresAt: Date.now() + LOOPBACK_AUTH_FALLBACK_EXPIRES_SECONDS * 1000,
  };
}

function clearOAuthExpiryTimer(): void {
  if (activeOAuthExpiryTimer) clearTimeout(activeOAuthExpiryTimer);
  activeOAuthExpiryTimer = null;
}

function terminateOAuthProcess(): void {
  const child = activeOAuthProcess;
  activeOAuthProcess = null;
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode == null) child.kill('SIGKILL');
  }, DEVICE_AUTH_EXIT_GRACE_MS);
  forceTimer.unref?.();
}

export function cancelDingTalkDwsOAuth(): DingTalkDwsOAuthSnapshot {
  clearOAuthExpiryTimer();
  terminateOAuthProcess();
  activeOAuthSnapshot = null;
  const result: DingTalkDwsOAuthSnapshot = { status: 'needs_auth' };
  activeOAuthStartResolver?.(result);
  activeOAuthStartResolver = null;
  return result;
}

export function resetDingTalkDwsOAuth(): DingTalkDwsOAuthSnapshot {
  cancelDingTalkDwsOAuth();
  const resolved = resolveDwsExecutable();
  if (!resolved) return { status: 'unavailable' };

  try {
    execFileSync(resolved.executable, ['auth', 'reset', '--yes', '--format', 'json'], {
      encoding: 'utf8',
      timeout: 8000,
      env: buildDwsEnv(resolved.packageDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    statusNoteCache = null;
    return { status: 'needs_auth' };
  } catch {
    return { status: 'error', error: 'authorization_reset_failed' };
  }
}

export function getDingTalkDwsOAuthStatus(
  credentials?: DingTalkDwsOAuthCredentials,
): DingTalkDwsOAuthSnapshot {
  if (activeOAuthSnapshot) return { ...activeOAuthSnapshot };
  return { status: probeDingTalkDwsAuth(credentials) };
}

export async function startDingTalkDwsOAuth(
  credentials: DingTalkDwsOAuthCredentials,
): Promise<DingTalkDwsOAuthSnapshot> {
  if (activeOAuthProcess || activeOAuthStartResolver) {
    cancelDingTalkDwsOAuth();
  } else {
    clearOAuthExpiryTimer();
    activeOAuthSnapshot = null;
  }
  const resolved = resolveDwsExecutable();
  if (!resolved) return { status: 'unavailable' };
  if (probeDingTalkDwsAuth(credentials) === 'authorized') {
    statusNoteCache = null;
    return { status: 'authorized' };
  }

  activeOAuthSnapshot = { status: 'starting' };
  let output = '';

  return await new Promise<DingTalkDwsOAuthSnapshot>((resolve) => {
    let startSettled = false;
    let codeTimer: ReturnType<typeof setTimeout> | null = null;
    const settleStart = (snapshot: DingTalkDwsOAuthSnapshot) => {
      if (startSettled) return;
      startSettled = true;
      if (codeTimer) clearTimeout(codeTimer);
      activeOAuthStartResolver = null;
      resolve({ ...snapshot });
    };
    activeOAuthStartResolver = settleStart;

    let child: ChildProcess;
    try {
      // Desktop loopback OAuth is intentional here. Unlike device flow, DWS
      // can redirect to its local approval page when the organization has not
      // yet enabled CLI data access, allowing the user to request approval
      // from a primary administrator without falling back to a terminal.
      child = spawn(resolved.executable, ['auth', 'login', '--format', 'json'], {
        cwd: homedir(),
        env: buildDwsEnv(resolved.packageDir, credentials),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      activeOAuthSnapshot = { status: 'error', error: 'authorization_failed' };
      settleStart(activeOAuthSnapshot);
      return;
    }

    activeOAuthProcess = child;
    const consumeOutput = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-DEVICE_AUTH_OUTPUT_LIMIT);
      const parsed = parseDingTalkDwsLoginOutput(output);
      if (!parsed || activeOAuthProcess !== child) return;
      activeOAuthSnapshot = parsed;
      clearOAuthExpiryTimer();
      activeOAuthExpiryTimer = setTimeout(() => {
        if (activeOAuthProcess !== child) return;
        activeOAuthSnapshot = { status: 'error', error: 'authorization_expired' };
        terminateOAuthProcess();
      }, Math.max(0, (parsed.expiresAt ?? Date.now()) - Date.now()));
      activeOAuthExpiryTimer.unref?.();
      settleStart(parsed);
    };
    child.stdout?.on('data', consumeOutput);
    child.stderr?.on('data', consumeOutput);

    codeTimer = setTimeout(() => {
      if (activeOAuthProcess !== child) return;
      activeOAuthSnapshot = { status: 'error', error: 'authorization_start_timeout' };
      terminateOAuthProcess();
      settleStart(activeOAuthSnapshot);
    }, OAUTH_START_WAIT_MS);
    codeTimer.unref?.();

    child.once('error', (error) => {
      if (activeOAuthProcess === child) activeOAuthProcess = null;
      clearOAuthExpiryTimer();
      activeOAuthSnapshot = { status: 'error', error: error.message || 'authorization_failed' };
      settleStart(activeOAuthSnapshot);
    });
    child.once('close', (code) => {
      if (activeOAuthProcess !== child) return;
      activeOAuthProcess = null;
      clearOAuthExpiryTimer();
      const status = code === 0 ? probeDingTalkDwsAuth(credentials) : 'needs_auth';
      const error = code === 0 ? 'authorization_not_completed' : classifyDingTalkDwsOAuthError(output);
      activeOAuthSnapshot = status === 'authorized'
        ? { status: 'authorized' }
        : { status: 'error', error };
      if (activeOAuthSnapshot.status === 'error') {
        // Do not log raw CLI output: it can contain a one-time authorization code.
        logger.warn(`[dingtalk-dws] Workspace authorization failed (exit=${code ?? 'unknown'}, reason=${error})`);
      }
      statusNoteCache = null;
      settleStart(activeOAuthSnapshot);
    });
  });
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
    // The extracted vendor binary is self-contained. Do not retain archives
    // for every other OS/architecture in the user's OpenClaw tools directory.
    safeRmSync(join(targetDir, 'assets'));
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

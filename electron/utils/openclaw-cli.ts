/**
 * OpenClaw CLI utilities — cross-platform auto-install
 */
import { app } from 'electron';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';

// ── Quoting helpers ──────────────────────────────────────────────────────────

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quoteForPosix(value: string): string {
  return `"${escapeForDoubleQuotes(value)}"`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ── CLI command string (for display / copy) ──────────────────────────────────

export function getOpenClawCliCommand(): string {
  const entryPath = getOpenClawEntryPath();
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux') {
    const localBinPath = join(homedir(), '.local', 'bin', 'openclaw');
    if (existsSync(localBinPath)) {
      return quoteForPosix(localBinPath);
    }
  }

  if (platform === 'linux') {
    if (existsSync('/usr/local/bin/openclaw')) {
      return '/usr/local/bin/openclaw';
    }
  }

  if (!app.isPackaged) {
    const openclawDir = getOpenClawDir();
    const nodeModulesDir = dirname(openclawDir);
    const binName = platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    const binPath = join(nodeModulesDir, '.bin', binName);

    if (existsSync(binPath)) {
      if (platform === 'win32') {
        return `& ${quoteForPowerShell(binPath)}`;
      }
      return quoteForPosix(binPath);
    }
  }

  if (app.isPackaged) {
    if (platform === 'win32') {
      const cliDir = join(process.resourcesPath, 'cli');
      const cmdPath = join(cliDir, 'openclaw.cmd');
      if (existsSync(cmdPath)) {
        return quoteForPowerShell(cmdPath);
      }
    }

    const execPath = process.execPath;
    if (platform === 'win32') {
      return `$env:ELECTRON_RUN_AS_NODE=1; & ${quoteForPowerShell(execPath)} ${quoteForPowerShell(entryPath)}`;
    }
    return `ELECTRON_RUN_AS_NODE=1 ${quoteForPosix(execPath)} ${quoteForPosix(entryPath)}`;
  }

  if (platform === 'win32') {
    return `node ${quoteForPowerShell(entryPath)}`;
  }

  return `node ${quoteForPosix(entryPath)}`;
}

// ── Packaged CLI wrapper path ────────────────────────────────────────────────

function getPackagedCliWrapperPath(): string | null {
  if (!app.isPackaged) return null;
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux') {
    const wrapper = join(process.resourcesPath, 'cli', 'openclaw');
    return existsSync(wrapper) ? wrapper : null;
  }
  if (platform === 'win32') {
    const wrapper = join(process.resourcesPath, 'cli', 'openclaw.cmd');
    return existsSync(wrapper) ? wrapper : null;
  }
  return null;
}

// ── macOS / Linux install ────────────────────────────────────────────────────

function getCliTargetPath(): string {
  return join(homedir(), '.local', 'bin', 'openclaw');
}

export async function installOpenClawCli(): Promise<{
  success: boolean; path?: string; error?: string;
}> {
  const platform = process.platform;

  if (platform === 'win32') {
    return { success: false, error: 'Windows CLI is configured by the installer.' };
  }

  if (!app.isPackaged) {
    return { success: false, error: 'CLI install is only available in packaged builds.' };
  }

  const wrapperSrc = getPackagedCliWrapperPath();
  if (!wrapperSrc) {
    return { success: false, error: 'CLI wrapper not found in app resources.' };
  }

  const targetDir = join(homedir(), '.local', 'bin');
  const target = getCliTargetPath();

  try {
    mkdirSync(targetDir, { recursive: true });

    // Remove existing file/symlink to avoid EEXIST
    if (existsSync(target)) {
      unlinkSync(target);
    }

    symlinkSync(wrapperSrc, target);
    chmodSync(wrapperSrc, 0o755);
    logger.info(`OpenClaw CLI symlink created: ${target} -> ${wrapperSrc}`);
    return { success: true, path: target };
  } catch (error) {
    logger.error('Failed to install OpenClaw CLI:', error);
    return { success: false, error: String(error) };
  }
}

// ── Auto-install on first launch ─────────────────────────────────────────────

function isCliInstalled(): boolean {
  const platform = process.platform;

  if (platform === 'win32') return true; // handled by NSIS installer

  const target = getCliTargetPath();
  if (!existsSync(target)) return false;

  // Also check /usr/local/bin/openclaw for deb installs
  if (platform === 'linux' && existsSync('/usr/local/bin/openclaw')) return true;

  return true;
}

function ensureLocalBinInPath(): void {
  if (process.platform === 'win32') return;

  const localBin = join(homedir(), '.local', 'bin');
  const pathEnv = process.env.PATH || '';
  if (pathEnv.split(':').includes(localBin)) return;

  const shell = process.env.SHELL || '/bin/zsh';
  const profileFile = shell.includes('zsh')
    ? join(homedir(), '.zshrc')
    : shell.includes('fish')
      ? join(homedir(), '.config', 'fish', 'config.fish')
      : join(homedir(), '.bashrc');

  try {
    const marker = '.local/bin';
    let content = '';
    try {
      content = readFileSync(profileFile, 'utf-8');
    } catch {
      // file doesn't exist yet
    }

    if (content.includes(marker)) return;

    const line = shell.includes('fish')
      ? '\n# Added by ClawX\nfish_add_path "$HOME/.local/bin"\n'
      : '\n# Added by ClawX\nexport PATH="$HOME/.local/bin:$PATH"\n';

    appendFileSync(profileFile, line);
    logger.info(`Added ~/.local/bin to PATH in ${profileFile}`);
  } catch (error) {
    logger.warn('Failed to add ~/.local/bin to PATH:', error);
  }
}

export async function autoInstallCliIfNeeded(
  notify?: (path: string) => void,
): Promise<void> {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') return; // NSIS handles it

  const target = getCliTargetPath();
  const wrapperSrc = getPackagedCliWrapperPath();

  if (isCliInstalled()) {
    if (target && wrapperSrc && existsSync(target)) {
      try {
        unlinkSync(target);
        symlinkSync(wrapperSrc, target);
        logger.debug(`Refreshed CLI symlink: ${target} -> ${wrapperSrc}`);
      } catch {
        // non-critical
      }
    }
    return;
  }

  logger.info('Auto-installing openclaw CLI...');
  const result = await installOpenClawCli();
  if (result.success) {
    logger.info(`CLI auto-installed at ${result.path}`);
    ensureLocalBinInPath();
    if (result.path) notify?.(result.path);
  } else {
    logger.warn(`CLI auto-install failed: ${result.error}`);
  }
}

// ── Completion helpers ───────────────────────────────────────────────────────

function getNodeExecForCli(): string {
  if (process.platform === 'darwin' && app.isPackaged) {
    const appName = app.getName();
    const helperName = `${appName} Helper`;
    const helperPath = join(
      dirname(process.execPath),
      '../Frameworks',
      `${helperName}.app`,
      'Contents/MacOS',
      helperName,
    );
    if (existsSync(helperPath)) return helperPath;
  }
  return process.execPath;
}

export function generateCompletionCache(): void {
  if (!app.isPackaged) return;

  const entryPath = getOpenClawEntryPath();
  if (!existsSync(entryPath)) return;

  const execPath = getNodeExecForCli();

  const child = spawn(execPath, [entryPath, 'completion', '--write-state'], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_EMBEDDED_IN: 'ClawX',
    },
    stdio: 'ignore',
    detached: false,
  });

  child.on('close', (code) => {
    if (code === 0) {
      logger.info('OpenClaw completion cache generated');
    } else {
      logger.warn(`OpenClaw completion cache generation exited with code ${code}`);
    }
  });

  child.on('error', (err) => {
    logger.warn('Failed to generate completion cache:', err);
  });
}

export function installCompletionToProfile(): void {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') return;

  const entryPath = getOpenClawEntryPath();
  if (!existsSync(entryPath)) return;

  const execPath = getNodeExecForCli();

  const child = spawn(
    execPath,
    [entryPath, 'completion', '--install', '-y'],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCLAW_NO_RESPAWN: '1',
        OPENCLAW_EMBEDDED_IN: 'ClawX',
      },
      stdio: 'ignore',
      detached: false,
    },
  );

  child.on('close', (code) => {
    if (code === 0) {
      logger.info('OpenClaw completion installed to shell profile');
    } else {
      logger.warn(`OpenClaw completion install exited with code ${code}`);
    }
  });

  child.on('error', (err) => {
    logger.warn('Failed to install completion to shell profile:', err);
  });
}

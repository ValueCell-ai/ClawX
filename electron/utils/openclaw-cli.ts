/**
 * OpenClaw CLI utilities
 */
import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function quoteForPosix(value: string): string {
  return `"${escapeForDoubleQuotes(value)}"`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function getOpenClawCliCommand(): string {
  const entryPath = getOpenClawEntryPath();
  const platform = process.platform;

  if (platform === 'darwin') {
    const localBinPath = join(homedir(), '.local', 'bin', 'openclaw');
    if (existsSync(localBinPath)) {
      return quoteForPosix(localBinPath);
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

export async function installOpenClawCliMac(): Promise<{ success: boolean; path?: string; error?: string }>
{
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Install is only supported on macOS.' };
  }

  const entryPath = getOpenClawEntryPath();
  if (!existsSync(entryPath)) {
    return { success: false, error: `OpenClaw entry not found at: ${entryPath}` };
  }

  const execPath = process.execPath;
  const targetDir = join(homedir(), '.local', 'bin');
  const target = join(targetDir, 'openclaw');

  try {
    const script = [
      '#!/bin/sh',
      `ELECTRON_RUN_AS_NODE=1 "${escapeForDoubleQuotes(execPath)}" "${escapeForDoubleQuotes(entryPath)}" "$@"`,
      '',
    ].join('\n');

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(target, script, { mode: 0o755 });
    chmodSync(target, 0o755);
    return { success: true, path: target };
  } catch (error) {
    logger.error('Failed to install OpenClaw CLI:', error);
    return { success: false, error: String(error) };
  }
}

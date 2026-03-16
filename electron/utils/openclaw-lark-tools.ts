import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { prependPathEntry } from './env-path';
import { logger } from './logger';
import { getOpenClawConfigDir, getOpenClawConfigPath, getOpenClawDir } from './paths';

const OPENCLAW_LARK_TOOLS_TIMEOUT_MS = 5 * 60_000;

export interface OpenClawLarkToolsInstallOptions {
  appId?: string;
  appSecret?: string;
}

export interface FeishuPluginInstallResult {
  installed: boolean;
  warning?: string;
}

export interface OpenClawLarkToolsInstallResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  timedOut?: boolean;
  error?: string;
}

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function getOpenClawCliPathEntry(): string | null {
  if (app.isPackaged) {
    const cliDir = join(process.resourcesPath, 'cli');
    const wrapper = join(cliDir, process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw');
    return existsSync(wrapper) ? cliDir : null;
  }

  const openclawDir = getOpenClawDir();
  const binDir = join(dirname(openclawDir), '.bin');
  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  return existsSync(join(binDir, binName)) ? binDir : null;
}

export async function runOpenClawLarkToolsInstall(
  options: OpenClawLarkToolsInstallOptions = {},
): Promise<OpenClawLarkToolsInstallResult> {
  const command = getNpxCommand();
  const args = ['-y', '@larksuite/openclaw-lark-tools', 'install'];
  if (options.appId && options.appSecret) {
    args.push('--app', `${options.appId}:${options.appSecret}`);
  } else {
    args.push('--use-existing');
  }

  const cwd = process.cwd();
  let env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_HOME: process.cwd(),
    OPENCLAW_STATE_DIR: getOpenClawConfigDir(),
    OPENCLAW_CONFIG_PATH: getOpenClawConfigPath(),
    OPENCLAW_NO_RESPAWN: '1',
    OPENCLAW_EMBEDDED_IN: 'ClawX',
  };

  const cliPathEntry = getOpenClawCliPathEntry();
  if (cliPathEntry) {
    env = prependPathEntry(env, cliPathEntry).env as NodeJS.ProcessEnv;
  }

  logger.info('Running OpenClaw Lark tools install', {
    command,
    args,
    cwd,
    stateDir: env.OPENCLAW_STATE_DIR,
    cliPathEntry,
  });

  return await new Promise<OpenClawLarkToolsInstallResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: OpenClawLarkToolsInstallResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      logger.error(`OpenClaw Lark tools install timed out after ${OPENCLAW_LARK_TOOLS_TIMEOUT_MS}ms`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        command: `${command} ${args.join(' ')}`,
        cwd,
        timedOut: true,
        error: `Timed out after ${OPENCLAW_LARK_TOOLS_TIMEOUT_MS}ms`,
      });
    }, OPENCLAW_LARK_TOOLS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      logger.error('Failed to spawn OpenClaw Lark tools install:', error);
      finish({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        command: `${command} ${args.join(' ')}`,
        cwd,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      const success = code === 0;
      if (!success) {
        logger.warn('OpenClaw Lark tools install exited with error', { code, stderr, stdout });
      }
      finish({
        success,
        exitCode: code,
        stdout,
        stderr,
        command: `${command} ${args.join(' ')}`,
        cwd,
        error: success ? undefined : stderr.trim() || stdout.trim() || `Exited with code ${code ?? 'null'}`,
      });
    });
  });
}

function readStringField(config: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = config?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function installFeishuPluginWithLarkTools(
  config?: Record<string, unknown>,
): Promise<FeishuPluginInstallResult> {
  const result = await runOpenClawLarkToolsInstall({
    appId: readStringField(config, 'appId'),
    appSecret: readStringField(config, 'appSecret'),
  });

  if (result.success) {
    return { installed: true };
  }

  return {
    installed: false,
    warning: result.error || 'Feishu plugin install failed via OpenClaw Lark tools',
  };
}

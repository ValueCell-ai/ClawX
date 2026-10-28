import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';
import { forkOpenClawUtilityProcess } from './openclaw-utility-process';
import { getUvMirrorEnv } from './uv-env';

const MAX_COMMAND_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface OpenClawCommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  timedOut?: boolean;
  error?: string;
}

export interface OpenClawCommandOptions {
  /** Used in log lines, e.g. `doctor`. */
  label: string;
  timeoutMs: number;
}

function appendCommandOutput(
  label: string,
  current: string,
  currentBytes: number,
  data: Buffer | string,
  stream: 'stdout' | 'stderr',
  alreadyTruncated: boolean,
): { output: string; bytes: number; truncated: boolean } {
  if (alreadyTruncated) {
    return { output: current, bytes: currentBytes, truncated: true };
  }

  const chunk = typeof data === 'string' ? Buffer.from(data) : data;
  if (currentBytes + chunk.length <= MAX_COMMAND_OUTPUT_BYTES) {
    return {
      output: current + chunk.toString(),
      bytes: currentBytes + chunk.length,
      truncated: false,
    };
  }

  const remaining = Math.max(0, MAX_COMMAND_OUTPUT_BYTES - currentBytes);
  const appended = remaining > 0 ? chunk.subarray(0, remaining).toString() : '';
  logger.warn(
    `OpenClaw ${label} ${stream} exceeded ${MAX_COMMAND_OUTPUT_BYTES} bytes; truncating additional output`,
  );

  return {
    output: current + appended,
    bytes: MAX_COMMAND_OUTPUT_BYTES,
    truncated: true,
  };
}

function getBundledBinPath(): string {
  const target = `${process.platform}-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
}

/** Run an OpenClaw CLI command in the utility process with bounded output. */
export async function runOpenClawCommand(
  args: string[],
  options: OpenClawCommandOptions,
): Promise<OpenClawCommandResult> {
  const { label, timeoutMs } = options;
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();
  const command = `openclaw ${args.join(' ')}`;
  const startedAt = Date.now();

  if (!existsSync(entryScript)) {
    const error = `OpenClaw entry script not found at ${entryScript}`;
    logger.error(`Cannot run OpenClaw ${label}: ${error}`);
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      command,
      cwd: openclawDir,
      durationMs: Date.now() - startedAt,
      error,
    };
  }

  const binPath = getBundledBinPath();
  const binPathExists = existsSync(binPath);
  const finalPath = binPathExists
    ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH || '';
  const uvEnv = await getUvMirrorEnv();

  logger.info(
    `Running OpenClaw ${label} (entry="${entryScript}", args="${args.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<OpenClawCommandResult>((resolve) => {
    const child = forkOpenClawUtilityProcess(entryScript, args, {
      cwd: openclawDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...uvEnv,
        PATH: finalPath,
        OPENCLAW_NO_RESPAWN: '1',
      } as NodeJS.ProcessEnv,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    const finish = (result: Omit<OpenClawCommandResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      logger.error(`OpenClaw ${label} timed out after ${timeoutMs}ms`);
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
        command,
        cwd: openclawDir,
        timedOut: true,
        error: `Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      const next = appendCommandOutput(label, stdout, stdoutBytes, data, 'stdout', stdoutTruncated);
      stdout = next.output;
      stdoutBytes = next.bytes;
      stdoutTruncated = next.truncated;
    });

    child.stderr?.on('data', (data) => {
      const next = appendCommandOutput(label, stderr, stderrBytes, data, 'stderr', stderrTruncated);
      stderr = next.output;
      stderrBytes = next.bytes;
      stderrTruncated = next.truncated;
    });

    child.on('error', (error: unknown) => {
      clearTimeout(timeout);
      logger.error(`Failed to spawn OpenClaw ${label} process:`, error);
      finish({
        success: false,
        exitCode: null,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      logger.info(`OpenClaw ${label} exited with code ${code ?? 'null'}`);
      finish({
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
      });
    });
  });
}

import { app, utilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';
import { getUvMirrorEnv } from './uv-env';

const OPENCLAW_DOCTOR_TIMEOUT_MS = 60_000;
const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;
const OPENCLAW_DOCTOR_ARGS = ['doctor'];
const OPENCLAW_DOCTOR_FIX_ARGS = ['doctor', '--fix', '--yes', '--non-interactive'];

export type OpenClawDoctorMode = 'diagnose' | 'fix';

export interface OpenClawDoctorResult {
  mode: OpenClawDoctorMode;
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

function appendDoctorOutput(
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
  if (currentBytes + chunk.length <= MAX_DOCTOR_OUTPUT_BYTES) {
    return {
      output: current + chunk.toString(),
      bytes: currentBytes + chunk.length,
      truncated: false,
    };
  }

  const remaining = Math.max(0, MAX_DOCTOR_OUTPUT_BYTES - currentBytes);
  const appended = remaining > 0 ? chunk.subarray(0, remaining).toString() : '';
  logger.warn(
    `OpenClaw doctor ${stream} exceeded ${MAX_DOCTOR_OUTPUT_BYTES} bytes; truncating additional output`,
  );

  return {
    output: current + appended,
    bytes: MAX_DOCTOR_OUTPUT_BYTES,
    truncated: true,
  };
}

function getBundledBinPath(): string {
  const target = `${process.platform}-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
}

async function runDoctorCommandWithArgs(
  mode: OpenClawDoctorMode,
  args: string[],
): Promise<OpenClawDoctorResult> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();
  const command = `openclaw ${args.join(' ')}`;
  const startedAt = Date.now();

  if (!existsSync(entryScript)) {
    const error = `OpenClaw entry script not found at ${entryScript}`;
    logger.error(`Cannot run OpenClaw doctor: ${error}`);
    return {
      mode,
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
    `Running OpenClaw doctor (mode=${mode}, entry="${entryScript}", args="${args.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<OpenClawDoctorResult>((resolve) => {
    const child = utilityProcess.fork(entryScript, args, {
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

    const finish = (result: Omit<OpenClawDoctorResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      logger.error(`OpenClaw doctor timed out after ${OPENCLAW_DOCTOR_TIMEOUT_MS}ms`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        mode,
        success: false,
        exitCode: null,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
        timedOut: true,
        error: `Timed out after ${OPENCLAW_DOCTOR_TIMEOUT_MS}ms`,
      });
    }, OPENCLAW_DOCTOR_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      const next = appendDoctorOutput(stdout, stdoutBytes, data, 'stdout', stdoutTruncated);
      stdout = next.output;
      stdoutBytes = next.bytes;
      stdoutTruncated = next.truncated;
    });

    child.stderr?.on('data', (data) => {
      const next = appendDoctorOutput(stderr, stderrBytes, data, 'stderr', stderrTruncated);
      stderr = next.output;
      stderrBytes = next.bytes;
      stderrTruncated = next.truncated;
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      logger.error('Failed to spawn OpenClaw doctor process:', error);
      finish({
        mode,
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
      logger.info(`OpenClaw doctor exited with code ${code ?? 'null'}`);
      finish({
        mode,
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

export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs('diagnose', OPENCLAW_DOCTOR_ARGS);
}

export async function runOpenClawDoctorFix(): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs('fix', OPENCLAW_DOCTOR_FIX_ARGS);
}

import { app } from 'electron';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getUvMirrorEnv } from './uv-env';
import { logger } from './logger';

/**
 * Get the path to the bundled uv binary
 */
function getBundledUvPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';
  
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binName);
  } else {
    return join(process.cwd(), 'resources', 'bin', target, binName);
  }
}

/**
 * Resolve the best uv binary to use.
 *
 * In packaged mode we always prefer the bundled binary so we never accidentally
 * pick up a system-wide uv that may be a different (possibly broken) version.
 * In dev we fall through to the system PATH for convenience.
 */
function resolveUvBin(): { bin: string; source: 'bundled' | 'path' | 'bundled-fallback' } {
  const bundled = getBundledUvPath();

  if (app.isPackaged) {
    if (existsSync(bundled)) {
      return { bin: bundled, source: 'bundled' };
    }
    logger.warn(`Bundled uv binary not found at ${bundled}, falling back to system PATH`);
  }

  // Dev mode or missing bundled binary — check system PATH
  const found = findUvInPathSync();
  if (found) return { bin: 'uv', source: 'path' };

  if (existsSync(bundled)) {
    return { bin: bundled, source: 'bundled-fallback' };
  }

  return { bin: 'uv', source: 'path' };
}

function findUvInPathSync(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe uv' : 'which uv';
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if uv is available (either bundled or in system PATH)
 */
export async function checkUvInstalled(): Promise<boolean> {
  const { bin, source } = resolveUvBin();
  if (source === 'bundled' || source === 'bundled-fallback') {
    return existsSync(bin);
  }
  return findUvInPathSync();
}

/**
 * "Install" uv - now just verifies that uv is available somewhere.
 * Kept for API compatibility with frontend.
 */
export async function installUv(): Promise<void> {
  const isAvailable = await checkUvInstalled();
  if (!isAvailable) {
    const bin = getBundledUvPath();
    throw new Error(`uv not found in system PATH and bundled binary missing at ${bin}`);
  }
  logger.info('uv is available and ready to use');
}

/**
 * Check if a managed Python 3.12 is ready and accessible
 */
export async function isPythonReady(): Promise<boolean> {
  const { bin: uvBin } = resolveUvBin();

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(uvBin, ['python', 'find', '3.12'], {
        shell: process.platform === 'win32',
      });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Run `uv python install 3.12` once with the given environment.
 * Returns on success, throws with captured stderr on failure.
 */
async function runPythonInstall(
  uvBin: string,
  env: Record<string, string | undefined>,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];

    const child = spawn(uvBin, ['python', 'install', '3.12'], {
      shell: process.platform === 'win32',
      env,
    });

    child.stdout?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stdoutChunks.push(line);
        logger.debug(`[python-setup:${label}] stdout: ${line}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stderrChunks.push(line);
        logger.info(`[python-setup:${label}] stderr: ${line}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = stderrChunks.join('\n');
        const stdout = stdoutChunks.join('\n');
        const detail = stderr || stdout || '(no output captured)';
        reject(new Error(
          `Python installation failed with code ${code} [${label}]\n` +
          `  uv binary: ${uvBin}\n` +
          `  platform: ${process.platform}/${process.arch}\n` +
          `  output: ${detail}`
        ));
      }
    });

    child.on('error', (err) => {
      reject(new Error(
        `Python installation spawn error [${label}]: ${err.message}\n` +
        `  uv binary: ${uvBin}\n` +
        `  platform: ${process.platform}/${process.arch}`
      ));
    });
  });
}

/**
 * Use bundled uv to install a managed Python version (default 3.12).
 *
 * Tries with mirror env first (for CN region), then retries without mirror
 * if the first attempt fails, to rule out mirror-specific issues.
 */
export async function setupManagedPython(): Promise<void> {
  const { bin: uvBin, source } = resolveUvBin();
  const uvEnv = await getUvMirrorEnv();
  const hasMirror = Object.keys(uvEnv).length > 0;

  logger.info(
    `Setting up managed Python 3.12 ` +
    `(uv=${uvBin}, source=${source}, arch=${process.arch}, mirror=${hasMirror})`
  );

  const baseEnv: Record<string, string | undefined> = { ...process.env };

  // Attempt 1: with mirror (if applicable)
  try {
    await runPythonInstall(uvBin, { ...baseEnv, ...uvEnv }, hasMirror ? 'mirror' : 'default');
  } catch (firstError) {
    logger.warn('Python install attempt 1 failed:', firstError);

    if (hasMirror) {
      // Attempt 2: retry without mirror to rule out mirror issues
      logger.info('Retrying Python install without mirror...');
      try {
        await runPythonInstall(uvBin, baseEnv, 'no-mirror');
      } catch (secondError) {
        logger.error('Python install attempt 2 (no mirror) also failed:', secondError);
        throw secondError;
      }
    } else {
      throw firstError;
    }
  }

  // After installation, verify and log the Python path
  try {
    const findPath = await new Promise<string>((resolve) => {
      const child = spawn(uvBin, ['python', 'find', '3.12'], {
        shell: process.platform === 'win32',
        env: { ...process.env, ...uvEnv },
      });
      let output = '';
      child.stdout?.on('data', (data) => { output += data; });
      child.on('close', () => resolve(output.trim()));
    });
    
    if (findPath) {
      logger.info(`Managed Python 3.12 installed at: ${findPath}`);
    }
  } catch (err) {
    logger.warn('Could not determine Python path after install:', err);
  }
}

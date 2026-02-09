import { app } from 'electron';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getUvMirrorEnv } from './uv-env';

/**
 * Get the path to the bundled uv binary
 */
function getBundledUvPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';
  
  if (app.isPackaged) {
    // In production, we flattened the structure to 'bin/'
    return join(process.resourcesPath, 'bin', binName);
  } else {
    // In dev, resources are at project root/resources/bin/<platform>-<arch>
    return join(process.cwd(), 'resources', 'bin', target, binName);
  }
}

/**
 * Check if uv is available (either in system PATH or bundled)
 */
export async function checkUvInstalled(): Promise<boolean> {
  // 1. Check system PATH first
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  if (inPath) return true;

  // 2. Check bundled path
  const bin = getBundledUvPath();
  return existsSync(bin);
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
  console.log('uv is available and ready to use');
}

/**
 * Check if a managed Python 3.12 is ready and accessible
 */
export async function isPythonReady(): Promise<boolean> {
  // Use 'uv' if in PATH, otherwise use full bundled path
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  const uvBin = inPath ? 'uv' : getBundledUvPath();

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
 * Use bundled uv to install a managed Python version (default 3.12)
 * Automatically picks the best available uv binary
 */
export async function setupManagedPython(): Promise<void> {
  // Use 'uv' if in PATH, otherwise use full bundled path
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  const uvBin = inPath ? 'uv' : getBundledUvPath();
  
  console.log(`Setting up python with: ${uvBin}`);
  const uvEnv = await getUvMirrorEnv();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(uvBin, ['python', 'install', '3.12'], {
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ...uvEnv,
      },
    });

    child.stdout?.on('data', (data) => {
      console.log(`python setup stdout: ${data}`);
    });

    child.stderr?.on('data', (data) => {
      // uv prints progress to stderr, so we log it as info
      console.log(`python setup info: ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python installation failed with code ${code}`));
    });

    child.on('error', (err) => reject(err));
  });

  // After installation, find and print where the Python executable is
  try {
    const findPath = await new Promise<string>((resolve) => {
      const child = spawn(uvBin, ['python', 'find', '3.12'], {
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          ...uvEnv,
        },
      });
      let output = '';
      child.stdout?.on('data', (data) => { output += data; });
      child.on('close', () => resolve(output.trim()));
    });
    
    if (findPath) {
      console.log(`✅ Managed Python 3.12 path: ${findPath}`);
      // Note: uv stores environments in a central cache, 
      // Individual skills will create their own venvs in ~/.cache/uv or similar.
    }
  } catch (err) {
    console.warn('Could not determine Python path:', err);
  }
}

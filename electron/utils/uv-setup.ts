import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Check if uv is installed by looking in PATH and common installation directories
 */
export async function checkUvInstalled(): Promise<boolean> {
  // 1. Check PATH
  const inPath = await new Promise<boolean>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const child = spawn(cmd, ['uv']);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

  if (inPath) return true;

  // 2. Check common absolute paths (useful if just installed and PATH hasn't refreshed)
  const commonPaths = process.platform === 'win32'
    ? [
      join(homedir(), '.cargo', 'bin', 'uv.exe'),
      join(process.env.APPDATA || '', '..', 'Local', 'Microsoft', 'WindowsApps', 'uv.exe'),
    ]
    : [
      join(homedir(), '.local', 'bin', 'uv'),
      join(homedir(), '.cargo', 'bin', 'uv'),
      '/usr/local/bin/uv',
    ];

  return commonPaths.some(p => existsSync(p));
}

/**
 * Install uv using the official platform-specific scripts
 */
export async function installUv(): Promise<void> {
  return new Promise((resolve, reject) => {
    let command: string;
    let args: string[];
    let errorOutput = '';

    if (process.platform === 'win32') {
      command = 'powershell.exe';
      args = [
        '-NoProfile',
        '-ExecutionPolicy', 'ByPass',
        '-Command',
        'irm https://astral.sh/uv/install.ps1 | iex'
      ];
    } else {
      command = 'sh';
      args = ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'];
    }

    const child = spawn(command, args, { shell: true });

    child.stdout?.on('data', (data) => {
      console.log(`uv install: ${data}`);
    });

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`uv install error: ${data}`);
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const msg = errorOutput.trim() || `Installation failed with code ${code}`;
        reject(new Error(msg));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

/**
 * Use uv to install a managed Python version (default 3.12)
 */
export async function setupManagedPython(): Promise<void> {
  const uvBin = await resolveUvPath();
  let errorOutput = '';

  return new Promise((resolve, reject) => {
    const child = spawn(uvBin, ['python', 'install', '3.12'], {
      shell: process.platform === 'win32'
    });

    child.stdout?.on('data', (data) => {
      console.log(`python setup: ${data}`);
    });

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`python setup error: ${data}`);
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const msg = errorOutput.trim() || `Python setup failed with code ${code}`;
        reject(new Error(msg));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

/**
 * Helper to find the uv executable path
 */
async function resolveUvPath(): Promise<string> {
  // Check PATH first
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  const foundInPath = await new Promise<string>((resolve) => {
    const child = spawn(cmd, ['uv']);
    let output = '';
    child.stdout.on('data', (d) => output += d);
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim().split('\n')[0].split('\n')[0]);
      else resolve('');
    });
  });

  if (foundInPath) return foundInPath;

  // Check common absolute paths
  const commonPaths = process.platform === 'win32'
    ? [join(homedir(), '.cargo', 'bin', 'uv.exe')]
    : [join(homedir(), '.local', 'bin', 'uv'), join(homedir(), '.cargo', 'bin', 'uv')];

  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }

  return 'uv'; // Fallback to just name
}

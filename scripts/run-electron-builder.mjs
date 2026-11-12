import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { getWindowsSigningConfig } = require('./windows-signing.cjs');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function createBuilderInvocation({
  args = [],
  platform = process.platform,
  env = process.env,
  root = ROOT,
  execPath = process.execPath,
} = {}) {
  const builderArgs = [...args];
  const signing = getWindowsSigningConfig(env, { platform });
  if (signing) {
    if (args.some((arg) => /^(--mac|--linux|--platform(?:=|$)|-m$|-l$)/.test(arg))) {
      throw new Error('CLAWX_WINDOWS_SIGNING is only supported for Windows builds.');
    }
    // A release must use the shared signing policy. Output/target overrides
    // remain available, but a second config file or signing override does not.
    if (args.some((arg) => /^(--config(?:=|$)|-c(?:=|$)|(?:--config\.|-c\.)(?:win(?:\.|=|$)|forceCodeSigning(?:=|$)))/.test(arg))) {
      throw new Error('Signed Windows builds cannot override the shared Windows signing configuration.');
    }
    builderArgs.push('--config', path.join(root, 'scripts', 'windows-builder-config.cjs'));
  }

  // Invoke JavaScript directly: .cmd + shell:true would interpret publisher
  // names or paths containing shell metacharacters on Windows.
  const cliArgs = [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ...builderArgs];
  if (platform === 'darwin') {
    const command = [
      'ulimit -n 65536 >/dev/null 2>&1 || ulimit -n 32768 >/dev/null 2>&1 || ulimit -n 16384 >/dev/null 2>&1 || true',
      `exec ${shellQuote(execPath)} ${cliArgs.map(shellQuote).join(' ')}`,
    ].join('; ');
    return { command: '/bin/bash', args: ['-lc', command], options: { cwd: root, stdio: 'inherit', env, shell: false } };
  }
  return { command: execPath, args: cliArgs, options: { cwd: root, stdio: 'inherit', env, shell: false } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const invocation = createBuilderInvocation({ args: process.argv.slice(2) });
    const child = spawn(invocation.command, invocation.args, invocation.options);
    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
    child.on('error', () => {
      console.error('Unable to start electron-builder. Run pnpm install first.');
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

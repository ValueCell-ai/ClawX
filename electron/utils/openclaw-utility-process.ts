import { app, utilityProcess } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const OPENCLAW_UTILITY_ENTRY_ENV = 'CLAWX_OPENCLAW_ENTRY';

const OPENCLAW_UTILITY_BOOTSTRAP_FILE = 'openclaw-utility-bootstrap.mjs';
export const OPENCLAW_RUNTIME_COMPAT_FILE = 'openclaw-runtime-compat.mjs';

/**
 * OpenClaw re-executes process.execPath for SQLite readers and migrations.
 * Patching only the utility process is insufficient: spawn-broker starts its
 * own children with captured environments that omit ELECTRON_RUN_AS_NODE.
 * Preload this shim in each runtime child and Worker (even with execArgv: []).
 * Do not set RUN_AS_NODE on utilityProcess.fork itself or use NODE_OPTIONS:
 * the former breaks Electron's utility startup; packaged apps reject the latter.
 */
export const OPENCLAW_RUNTIME_COMPAT_SOURCE = String.raw`
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const compatUrl = import.meta.url;
const normalize = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const isRuntime = (command) => typeof command === 'string' && normalize(command) === normalize(process.execPath);
const withPreload = (args) => args.some((arg, i) =>
  arg === '--import=' + compatUrl || (arg === '--import' && args[i + 1] === compatUrl)
) ? [...args] : ['--import', compatUrl, ...args];
const nodeEnv = (env) => ({ ...(env ?? process.env), ELECTRON_RUN_AS_NODE: '1' });

function withRuntime(args) {
  if (!isRuntime(args[0])) return args;
  const next = [...args];
  if (!Array.isArray(next[1])) {
    if (next[1] == null && next.length > 2) next[1] = [];
    else next.splice(1, 0, []);
  }
  next[1] = withPreload(next[1]);
  const options = next[2];
  if (typeof options === 'function') next.splice(2, 0, { env: nodeEnv() });
  else next[2] = { ...options, env: nodeEnv(options?.env) };
  return next;
}

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method];
  const patched = function (...args) {
    return original.apply(this, withRuntime(args));
  };
  const custom = original[promisify.custom];
  if (typeof custom === 'function') {
    Object.defineProperty(patched, promisify.custom, {
      value: (...args) => custom(...withRuntime(args)),
    });
  }
  childProcess[method] = patched;
}
const originalFork = childProcess.fork;
childProcess.fork = function (modulePath, args, options) {
  if (!Array.isArray(args)) {
    options = args ?? options;
    args = [];
  }
  if (!options?.execPath || isRuntime(options.execPath)) {
    options = {
      ...options,
      env: nodeEnv(options?.env),
      execArgv: withPreload(options?.execArgv ?? process.execArgv),
    };
  }
  return originalFork.call(this, modulePath instanceof URL ? fileURLToPath(modulePath) : modulePath, args, options);
};
const OriginalWorker = workerThreads.Worker;
workerThreads.Worker = class extends OriginalWorker {
  constructor(filename, options) {
    super(filename, { ...options, execArgv: withPreload(options?.execArgv ?? process.execArgv) });
  }
};
syncBuiltinESMExports();

if (process.env.OPENCLAW_DEBUG === '1') {
  const previousPrepare = Error.prepareStackTrace;
  const MAX_CHAIN_DEPTH = 4;
  const MAX_CHAIN_ERRORS = 8;
  // V8 does not re-enter prepareStackTrace for stacks read while formatting,
  // so nested errors are expanded here rather than by their own stack hook.
  const expanded = new WeakSet();
  const active = new Set();
  const indent = (text) => String(text).split('\n').join('\n    ');
  const header = (error) => {
    try {
      return Error.prototype.toString.call(error);
    } catch {
      return 'Error';
    }
  };
  const describe = (value, depth) => {
    try {
      if (!(value instanceof Error)) {
        return typeof value === 'string' ? value : String(JSON.stringify(value) ?? value);
      }
      if (active.has(value)) return header(value) + ' [circular]';
      const text = String(value.stack || header(value));
      return expanded.has(value) ? text : text + chain(value, depth);
    } catch {
      return Object.prototype.toString.call(value);
    }
  };
  const chain = (error, depth) => {
    if (!error || typeof error !== 'object' || depth >= MAX_CHAIN_DEPTH) return '';
    let errors;
    let cause;
    try {
      errors = Array.isArray(error.errors) ? error.errors : undefined;
      cause = error.cause;
    } catch {
      return '';
    }
    active.add(error);
    try {
      const parts = [];
      for (const [index, entry] of (errors ?? []).slice(0, MAX_CHAIN_ERRORS).entries()) {
        parts.push('\n  [errors[' + index + ']] ' + indent(describe(entry, depth + 1)));
      }
      if (errors && errors.length > MAX_CHAIN_ERRORS) {
        parts.push('\n  [errors] ' + (errors.length - MAX_CHAIN_ERRORS) + ' more');
      }
      if (cause !== undefined && !errors?.includes(cause)) {
        parts.push('\n  [cause] ' + indent(describe(cause, depth + 1)));
      }
      return parts.join('');
    } finally {
      active.delete(error);
    }
  };
  Error.prepareStackTrace = (error, frames) => {
    const stack = typeof previousPrepare === 'function'
      ? previousPrepare(error, frames)
      : header(error) + frames.map((frame) => '\n    at ' + frame).join('');
    if (typeof stack !== 'string' || active.has(error)) return stack;
    expanded.add(error);
    return stack + chain(error, 0);
  };
}
`;

export const OPENCLAW_UTILITY_BOOTSTRAP_SOURCE = [
  `import './${OPENCLAW_RUNTIME_COMPAT_FILE}';`,
  "import { pathToFileURL } from 'node:url';",
  `const entry = process.env.${OPENCLAW_UTILITY_ENTRY_ENV};`,
  `delete process.env.${OPENCLAW_UTILITY_ENTRY_ENV};`,
  'if (!entry) {',
  `  console.error('[clawx] ${OPENCLAW_UTILITY_ENTRY_ENV} is required to launch OpenClaw');`,
  '  process.exit(1);',
  '}',
  'process.argv[1] = entry;',
  'await import(pathToFileURL(entry).href);',
  '',
].join('\n');

function ensureSource(filePath: string, source: string): void {
  try {
    if (readFileSync(filePath, 'utf8') === source) return;
  } catch {
    // Missing or unreadable generated source must be written before launch.
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source, 'utf8');
}

export function ensureOpenClawUtilityBootstrap(directory: string = app.getPath('userData')): string {
  ensureSource(path.join(directory, OPENCLAW_RUNTIME_COMPAT_FILE), OPENCLAW_RUNTIME_COMPAT_SOURCE);
  const bootstrapPath = path.join(directory, OPENCLAW_UTILITY_BOOTSTRAP_FILE);
  ensureSource(bootstrapPath, OPENCLAW_UTILITY_BOOTSTRAP_SOURCE);
  return bootstrapPath;
}

/**
 * Fork OpenClaw with Node-mode compatibility throughout its runtime process tree.
 * OPENCLAW_DEBUG only changes OpenClaw's CLI failure output: without it a
 * startup failure prints "The CLI command failed." with no reason or stack.
 */
export function forkOpenClawUtilityProcess(
  entryScript: string,
  args: string[],
  options: Electron.ForkOptions,
): Electron.UtilityProcess {
  return utilityProcess.fork(ensureOpenClawUtilityBootstrap(), args, {
    ...options,
    env: {
      ...(options.env ?? process.env),
      OPENCLAW_DEBUG: '1',
      [OPENCLAW_UTILITY_ENTRY_ENV]: entryScript,
    },
  });
}

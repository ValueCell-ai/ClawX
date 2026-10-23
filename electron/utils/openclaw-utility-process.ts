import { app, utilityProcess } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const OPENCLAW_UTILITY_ENTRY_ENV = 'CLAWX_OPENCLAW_ENTRY';

const OPENCLAW_UTILITY_BOOTSTRAP_FILE = 'openclaw-utility-bootstrap.mjs';

/**
 * OpenClaw re-executes its own runtime (`process.execPath`) through spawn,
 * spawnSync, execFile, and execFileSync for SQLite readers, schema/database
 * preflight, migrations, and tool hosts. Inside an Electron utilityProcess that
 * binary is the ClawX Helper, and Electron only rewrites `fork()` to run as
 * Node; the other calls boot a second ClawX app instead. Electron's `fork()`
 * rewrite also only applies to string module paths, while OpenClaw forks its
 * SQLite integrity and preflight workers from `file:` URLs. Setting
 * ELECTRON_RUN_AS_NODE on the utilityProcess itself breaks it, so the
 * bootstrap marks only re-execs of the runtime binary and hands `fork()` a
 * path before importing the OpenClaw entry.
 */
export const OPENCLAW_UTILITY_BOOTSTRAP_SOURCE = [
  "import childProcess from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  "import path from 'node:path';",
  "import { fileURLToPath, pathToFileURL } from 'node:url';",
  "import { promisify } from 'node:util';",
  '',
  `const ENTRY_ENV = '${OPENCLAW_UTILITY_ENTRY_ENV}';`,
  "const RUN_AS_NODE_ENV = 'ELECTRON_RUN_AS_NODE';",
  '',
  'const entry = process.env[ENTRY_ENV];',
  'delete process.env[ENTRY_ENV];',
  'if (!entry) {',
  "  console.error('[clawx] ' + ENTRY_ENV + ' is required to launch OpenClaw');",
  '  process.exit(1);',
  '}',
  '',
  'const runtimePath = path.resolve(process.execPath);',
  '',
  'function withRunAsNode(args) {',
  "  if (typeof args[0] !== 'string' || path.resolve(args[0]) !== runtimePath) return args;",
  '  const next = [...args];',
  '  const optionsIndex = Array.isArray(next[1]) || (next[1] == null && next.length > 2) ? 2 : 1;',
  '  const options = next[optionsIndex];',
  "  if (typeof options === 'function') {",
  '    next.splice(optionsIndex, 0, { env: { ...process.env, [RUN_AS_NODE_ENV]: \'1\' } });',
  '    return next;',
  '  }',
  '  next[optionsIndex] = { ...options, env: { ...(options?.env ?? process.env), [RUN_AS_NODE_ENV]: \'1\' } };',
  '  return next;',
  '}',
  '',
  "for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {",
  '  const original = childProcess[method];',
  '  const patched = function (...args) {',
  '    return original.apply(this, withRunAsNode(args));',
  '  };',
  '  const custom = original[promisify.custom];',
  "  if (typeof custom === 'function') {",
  '    Object.defineProperty(patched, promisify.custom, {',
  '      value: (...args) => custom(...withRunAsNode(args)),',
  '    });',
  '  }',
  '  childProcess[method] = patched;',
  '}',
  'const originalFork = childProcess.fork;',
  'childProcess.fork = function (modulePath, ...rest) {',
  '  return originalFork.call(this, modulePath instanceof URL ? fileURLToPath(modulePath) : modulePath, ...rest);',
  '};',
  'syncBuiltinESMExports();',
  '',
  'process.argv[1] = entry;',
  'await import(pathToFileURL(entry).href);',
  '',
].join('\n');

export function ensureOpenClawUtilityBootstrap(directory: string = app.getPath('userData')): string {
  const bootstrapPath = path.join(directory, OPENCLAW_UTILITY_BOOTSTRAP_FILE);
  let current: string | undefined;
  try {
    current = readFileSync(bootstrapPath, 'utf8');
  } catch {
    current = undefined;
  }
  if (current !== OPENCLAW_UTILITY_BOOTSTRAP_SOURCE) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(bootstrapPath, OPENCLAW_UTILITY_BOOTSTRAP_SOURCE, 'utf8');
  }
  return bootstrapPath;
}

/** Fork an OpenClaw CLI entry in a utilityProcess whose runtime re-execs run as Node. */
export function forkOpenClawUtilityProcess(
  entryScript: string,
  args: string[],
  options: Electron.ForkOptions,
): Electron.UtilityProcess {
  return utilityProcess.fork(ensureOpenClawUtilityBootstrap(), args, {
    ...options,
    env: {
      ...(options.env ?? process.env),
      [OPENCLAW_UTILITY_ENTRY_ENV]: entryScript,
    },
  });
}

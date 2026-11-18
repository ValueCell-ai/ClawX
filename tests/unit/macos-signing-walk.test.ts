// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Resolve exactly the transitive signer used by electron-builder, including
// pnpm's patch hash, rather than importing a separate test-only dependency.
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const packagerRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
const signerRoot = dirname(packagerRequire.resolve('@electron/osx-sign/package.json'));
const formats = ['cjs', 'esm'] as const;
const fixtures: string[] = [];
let runners: string;

beforeAll(() => {
  runners = mkdtempSync(join(tmpdir(), 'clawx-signing-runners-'));
  for (const format of formats) {
    buildSync({
      entryPoints: [join(signerRoot, 'dist', format, 'util.js')],
      outfile: join(runners, `${format}.cjs`),
      bundle: true,
      platform: 'node',
      format: 'cjs',
    });
  }
  writeFileSync(join(runners, 'scan.cjs'), `
const fs = require('node:fs');
require(process.argv[2]).walkAsync(process.argv[3]).then(
  paths => fs.writeSync(1, JSON.stringify({ paths })),
  error => { fs.writeSync(1, JSON.stringify({ error: error.code })); process.exitCode = 1; },
);
`);
});

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});
afterAll(() => { if (runners) rmSync(runners, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clawx-signing-fixture-'));
  fixtures.push(root);
  return root;
}

function put(root: string, file: string, contents: string | Buffer): string {
  const target = resolve(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function scan(format: string, root: string, lowLimit = false) {
  const args = [join(runners, 'scan.cjs'), join(runners, `${format}.cjs`), root];
  const result = lowLimit
    ? spawnSync('/bin/bash', ['-c', 'ulimit -n 64 && exec "$@"', 'signing-walk', process.execPath, ...args], { encoding: 'utf8', timeout: 30000 })
    : spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
  expect(result.error).toBeUndefined();
  return { ...result, output: JSON.parse(result.stdout) as { paths?: string[]; error?: string } };
}

describe.each(formats)('macOS signing discovery (%s)', (format) => {
  it('retains native binaries and nested bundles in signing order while removing stale signature files', () => {
    const root = fixture();
    const binary = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);
    const executable = put(root, 'MacOS/ClawX', binary);
    const addon = put(root, 'Resources/deep/node_modules/addon/native.node', binary);
    const dylib = put(root, 'Frameworks/Native.framework/Versions/A/Native', binary);
    const helper = put(root, 'Frameworks/Helper.app/Contents/MacOS/Helper', binary);
    put(root, 'Resources/openclaw/dist/update-run-timeouts.mjs', 'export const timeout = 42;\n');
    const stale = put(root, 'Resources/old.cstemp', binary);
    const framework = join(root, 'Frameworks/Native.framework');
    const app = join(root, 'Frameworks/Helper.app');

    const result = scan(format, root);

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.output.paths?.toSorted()).toEqual([executable, addon, dylib, helper, framework, app].toSorted());
    expect(result.output.paths!.indexOf(dylib)).toBeLessThan(result.output.paths!.indexOf(framework));
    expect(result.output.paths!.indexOf(helper)).toBeLessThan(result.output.paths!.indexOf(app));
    expect(existsSync(stale)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('scans a broad recursive tree under a real 64-descriptor limit', () => {
    const root = fixture();
    for (let directory = 0; directory < 16; directory++) {
      for (let file = 0; file < 128; file++) {
        put(root, `Resources/openclaw/dist/${directory}/chunk-${file}.mjs`, 'export const value = 1;\n');
      }
    }
    const binary = put(root, 'Resources/native-addon.node', Buffer.from([0, 1, 2, 3]));

    const result = scan(format, root, true);

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.output).toEqual({ paths: [binary] });
  });

  it('propagates filesystem errors instead of silently skipping signing targets', () => {
    const result = scan(format, join(fixture(), 'missing'));
    expect(result.status).toBe(1);
    expect(result.output.error).toBe('ENOENT');
  });
});

// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const bundle = realpathSync(path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist/npm-install-env-B-C07WJc.mjs'));
const npmPackage = createRequire(bundle).resolve('npm/package.json');
const npmCli = path.join(path.dirname(npmPackage), 'bin', 'npm-cli.js');

async function resolveNpmCommand(platform: NodeJS.Platform, args: string[]): Promise<string[]> {
  const { s: resolve } = await import(pathToFileURL(bundle).href) as { s: (args: string[]) => string[] };
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  try {
    return resolve(args);
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

const envWithoutNpm = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));

describe('OpenClaw Doctor npm resolution', () => {
  it.each([
    { args: ['--version'], status: 0 },
    { args: ['clawx-unknown-command', 'one argument with spaces'], status: 1 },
  ])('runs the bundled CLI for $args on Windows without a system npm', async ({ args, status }) => {
    const [command, ...cliArgs] = await resolveNpmCommand('win32', args);
    expect([command, ...cliArgs]).toEqual([process.execPath, npmCli, ...args]);
    const result = spawnSync(command, cliArgs, {
      cwd: tmpdir(),
      env: { ...envWithoutNpm, PATH: '', npm_config_logs_max: '0' },
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    if (status === 0) {
      expect(result.stdout.trim()).toBe(JSON.parse(readFileSync(npmPackage, 'utf8')).version);
    } else {
      expect(result.stdout + result.stderr).toContain('clawx-unknown-command');
    }
  });

  it('preserves PATH-based npm on non-Windows Node', async () => {
    const args = ['config', 'get', 'registry'];
    expect(await resolveNpmCommand('linux', args)).toEqual(['npm', ...args]);
  });
});

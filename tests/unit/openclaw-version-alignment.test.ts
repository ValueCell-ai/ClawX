import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  devDependencies?: Record<string, string>;
};

const root = path.resolve(import.meta.dirname, '../..');

async function readText(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), 'utf8');
}

describe('OpenClaw runtime alignment', () => {
  it('pins the requested core and compatible official channel plugins', async () => {
    const packageJson = JSON.parse(await readText('package.json')) as PackageJson;
    expect(packageJson.devDependencies?.openclaw).toBe('2026.10.5');
    expect(packageJson.devDependencies?.['@openclaw/discord']).toBe('2026.10.5');
    expect(packageJson.devDependencies?.['@openclaw/whatsapp']).toBe('2026.10.5');
    // @openclaw/qqbot has no 2026.10.5 publication; its peer range supports the new core.
    expect(packageJson.devDependencies?.['@openclaw/qqbot']).toBe('2026.7.1');
  });

  it('does not retain the removed version-bound OpenClaw patch', async () => {
    const workspace = await readText('pnpm-workspace.yaml');
    const lockfile = await readText('pnpm-lock.yaml');
    expect(workspace).not.toContain('openclaw@2026.7.1-2');
    expect(lockfile).not.toContain('openclaw@2026.7.1-2');
    expect(lockfile).toContain('openclaw@2026.10.5');
    expect(workspace).toContain('openclaw@2026.10.5: patches/openclaw@2026.10.5.patch');
    expect(lockfile).toContain('path: patches/openclaw@2026.10.5.patch');
    expect(lockfile).toContain('path: patches/@wecom__wecom-openclaw-plugin@2026.8.17.patch');
  });

  it('applies the ClawX recovery-header compatibility patch to the installed runtime', async () => {
    const distDir = path.join(root, 'node_modules/openclaw/dist');
    const errorFiles = (await readdir(distDir)).filter((name) => /^errors-.*\.mjs$/.test(name));
    const errorSources = await Promise.all(errorFiles.map((name) => readFile(path.join(distDir, name), 'utf8')));
    const patchedIndex = errorSources.findIndex((source) => source.includes('TOKENDANCE_RECOVERY_ACTIONS'));
    expect(patchedIndex).toBeGreaterThanOrEqual(0);
    expect(errorSources[patchedIndex]).toContain('TokenDance-Recovery-Action');

    const patchedModule = await import(pathToFileURL(path.join(distDir, errorFiles[patchedIndex])).href) as {
      t: (error: unknown) => string;
    };
    const recoverable = Object.assign(new Error('provider quota exceeded'), {
      headers: new Headers({ 'TokenDance-Recovery-Action': 'api_key_quota' }),
    });
    expect(patchedModule.t(recoverable)).toContain('[TokenDance-Recovery-Action:api_key_quota]');
    const ignored = Object.assign(new Error('provider quota exceeded'), {
      headers: new Headers({ 'TokenDance-Recovery-Action': 'unexpected_value' }),
    });
    expect(patchedModule.t(ignored)).not.toContain('TokenDance-Recovery-Action:unexpected_value');
  });

  it('keeps bundling independent of generated OpenClaw chunk names', async () => {
    const bundleScript = await readText('scripts/bundle-openclaw.mjs');
    expect(bundleScript).toContain("path.join(NODE_MODULES, 'openclaw')");
    expect(bundleScript).toContain("path.join(OUTPUT, 'openclaw.mjs')");
    expect(bundleScript).not.toContain('2026.7.1');
  });
});

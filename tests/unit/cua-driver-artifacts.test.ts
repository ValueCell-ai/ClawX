import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import tar from 'tar';

import {
  CUA_DRIVER_RELEASE_TAG,
  CUA_DRIVER_VERSION,
  resolveCuaDriverArtifact,
} from '../../scripts/cua-driver-artifacts.mjs';
import { installCuaDriverArtifact, selectCuaDriverTargets } from '../../scripts/download-cua-driver.mjs';

const tempDirs: string[] = [];

async function createTempDir() {
  const directory = await mkdtemp(join(tmpdir(), 'clawx-cua-driver-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CUA driver artifacts', () => {
  it('pins the 0.21.0 macOS universal archive for both mac architectures', () => {
    expect(CUA_DRIVER_VERSION).toBe('0.21.0');
    expect(CUA_DRIVER_RELEASE_TAG).toBe('cua-driver-rs-v0.21.0');

    for (const target of ['darwin-x64', 'darwin-arm64']) {
      expect(resolveCuaDriverArtifact(target)).toMatchObject({
        asset: 'cua-driver-rs-0.21.0-darwin-universal-binary.tar.gz',
        sha256: '5e327e58f6ce81d5c117fe5edec5f267e87e1b921e8c5a8aa4f7f21cbcf5f273',
        binName: 'cua-driver',
        archiveEntry: 'cua-driver',
      });
    }
  });

  it('pins only the Windows x64 binary archive', () => {
    expect(resolveCuaDriverArtifact('win32-x64')).toMatchObject({
      asset: 'cua-driver-rs-0.21.0-windows-x86_64-binary.zip',
      sha256: 'd63f6a78e65afc06524048f5557fed36cdf01f0a8a680236e93c9a2fb3587f44',
      binName: 'cua-driver.exe',
      archiveEntry: 'cua-driver.exe',
    });
    expect(() => resolveCuaDriverArtifact('win32-arm64')).toThrow(/Unsupported CUA driver target/);
  });

  it('rejects unsupported targets', () => {
    expect(() => resolveCuaDriverArtifact('linux-x64')).toThrow(/Unsupported CUA driver target/);
  });
});

describe('CUA driver downloader', () => {
  it('selects the current target, platform groups, and all supported targets', () => {
    expect(selectCuaDriverTargets([], 'darwin', 'arm64')).toEqual([
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(selectCuaDriverTargets([], 'win32', 'x64')).toEqual(['win32-x64']);
    expect(selectCuaDriverTargets([], 'linux', 'x64')).toEqual([]);
    expect(selectCuaDriverTargets(['--platform=mac'], 'win32', 'x64')).toEqual([
      'darwin-x64',
      'darwin-arm64',
    ]);
    expect(selectCuaDriverTargets(['--platform=win'], 'darwin', 'arm64')).toEqual(['win32-x64']);
    expect(selectCuaDriverTargets(['--all'], 'darwin', 'arm64')).toEqual([
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
    ]);
    expect(() => selectCuaDriverTargets(['--platform=linux'], 'darwin', 'arm64')).toThrow(
      /Unknown platform/,
    );
  });

  it('verifies SHA256 before extraction', async () => {
    const outputBase = await createTempDir();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not the release archive'));

    await expect(installCuaDriverArtifact('win32-x64', { fetchImpl, outputBase })).rejects.toThrow(
      /SHA256 mismatch/,
    );
    await expect(stat(join(outputBase, 'win32-x64', 'cua-driver.exe'))).rejects.toThrow();
  });

  it('extracts only cua-driver.exe and preserves sibling binaries', async () => {
    const outputBase = await createTempDir();
    const targetDir = join(outputBase, 'win32-x64');
    await writeFile(join(outputBase, 'sibling-placeholder'), 'outside target');

    const zip = new JSZip();
    zip.file('cua-driver.exe', 'driver');
    zip.file('do-not-extract.txt', 'unexpected');
    const archive = await zip.generateAsync({ type: 'nodebuffer' });
    const sha256 = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(archive).digest('hex'),
    );
    const artifact = {
      ...resolveCuaDriverArtifact('win32-x64'),
      sha256,
    };

    await installCuaDriverArtifact('win32-x64', {
      artifact,
      fetchImpl: vi.fn().mockResolvedValue(new Response(archive)),
      outputBase,
    });

    expect(await readFile(join(targetDir, 'cua-driver.exe'), 'utf8')).toBe('driver');
    await expect(stat(join(targetDir, 'do-not-extract.txt'))).rejects.toThrow();
    expect(await readFile(join(outputBase, 'sibling-placeholder'), 'utf8')).toBe('outside target');
  });

  it('replaces only the CUA binary and makes POSIX output executable', async () => {
    const outputBase = await createTempDir();
    const archiveSource = await createTempDir();
    const targetDir = join(outputBase, 'darwin-arm64');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(targetDir, { recursive: true }));
    await writeFile(join(targetDir, 'uv'), 'keep me');
    await writeFile(join(targetDir, 'cua-driver'), 'old driver');
    await writeFile(join(archiveSource, 'cua-driver'), 'new driver');
    await writeFile(join(archiveSource, 'do-not-extract.txt'), 'unexpected');

    const archivePath = join(archiveSource, 'test.tar.gz');
    await tar.create(
      { cwd: archiveSource, file: archivePath, gzip: true },
      ['cua-driver', 'do-not-extract.txt'],
    );
    const archive = await readFile(archivePath);
    const sha256 = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(archive).digest('hex'),
    );
    const artifact = {
      ...resolveCuaDriverArtifact('darwin-arm64'),
      asset: 'test.tar.gz',
      sha256,
    };

    await installCuaDriverArtifact('darwin-arm64', {
      artifact,
      fetchImpl: vi.fn().mockResolvedValue(new Response(archive)),
      outputBase,
    });

    expect(await readFile(join(targetDir, 'cua-driver'), 'utf8')).toBe('new driver');
    expect(await readFile(join(targetDir, 'uv'), 'utf8')).toBe('keep me');
    await expect(stat(join(targetDir, 'do-not-extract.txt'))).rejects.toThrow();
    expect((await stat(join(targetDir, 'cua-driver'))).mode & 0o111).toBe(0o111);
  });
});

describe('CUA driver package scripts', () => {
  it('downloads artifacts only through developer and packaging preparation scripts', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const workspaceConfig = await readFile(join(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');

    expect(packageJson.scripts['cua-driver:download']).toBe('node scripts/download-cua-driver.mjs');
    expect(packageJson.scripts['cua-driver:download:mac']).toBe(
      'node scripts/download-cua-driver.mjs --platform=mac',
    );
    expect(packageJson.scripts['cua-driver:download:win']).toBe(
      'node scripts/download-cua-driver.mjs --platform=win',
    );
    expect(packageJson.scripts['cua-driver:download:all']).toBe(
      'node scripts/download-cua-driver.mjs --all',
    );
    expect(packageJson.scripts.init).toContain('pnpm run cua-driver:download');
    expect(packageJson.scripts['prep:mac-binaries']).toContain('pnpm run cua-driver:download:mac');
    expect(packageJson.scripts['prep:win-binaries']).toContain('pnpm run cua-driver:download:win');
    expect(packageJson.scripts['package:mac']).toContain('pnpm run prep:mac-binaries');
    expect(packageJson.scripts['package:mac:local']).toContain('pnpm run prep:mac-binaries');
    expect(packageJson.scripts.build).toContain('pnpm run cua-driver:download');
    expect(packageJson.scripts.release).toContain('pnpm run cua-driver:download');
    expect(packageJson.dependencies['@trycua/cua-driver']).toBe(CUA_DRIVER_VERSION);
    expect(packageJson.pnpm).toBeUndefined();
    expect(workspaceConfig).toMatch(/supportedArchitectures:\s+[\s\S]*cpu:\s+[\s\S]*- x64\s+[\s\S]*- arm64/);
  });
});

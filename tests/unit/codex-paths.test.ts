// @vitest-environment node
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => tmpdir()),
  },
}));

describe('Codex bundle path resolver', () => {
  const originalCwd = process.cwd();
  const originalOverride = process.env.CLAWX_CODEX_PATH;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.CLAWX_CODEX_PATH;
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-codex-paths-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalOverride === undefined) {
      delete process.env.CLAWX_CODEX_PATH;
    } else {
      process.env.CLAWX_CODEX_PATH = originalOverride;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses the dev bundled native Codex binary and helper path', async () => {
    const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const bundledDir = join(process.cwd(), 'build', 'codex', `${process.platform}-${process.arch}`);
    const binaryPath = join(bundledDir, 'bin', binaryName);
    const pathDir = join(bundledDir, 'codex-path');
    await mkdir(join(binaryPath, '..'), { recursive: true });
    await mkdir(pathDir, { recursive: true });
    await writeFile(binaryPath, 'mock codex', 'utf8');
    await chmod(binaryPath, 0o755);

    const { getCodexBundle, assertCodexBundle } = await import('@electron/runtime/codex-paths');

    expect(getCodexBundle()).toMatchObject({
      binaryPath,
      pathDir,
      baseDir: bundledDir,
    });
    expect(assertCodexBundle()).toMatchObject({ binaryPath, pathDir });
  });

  it('uses an explicit dev Codex binary override', async () => {
    const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
    const bundledDir = join(tempDir, 'mock-runtime', 'codex');
    const binaryPath = join(bundledDir, 'bin', binaryName);
    await mkdir(join(binaryPath, '..'), { recursive: true });
    await writeFile(binaryPath, 'mock codex override', 'utf8');
    await chmod(binaryPath, 0o755);
    process.env.CLAWX_CODEX_PATH = binaryPath;

    const { getCodexBundle, assertCodexBundle } = await import('@electron/runtime/codex-paths');

    expect(getCodexBundle()).toMatchObject({
      binaryPath,
      baseDir: bundledDir,
      pathDir: join(bundledDir, 'codex-path'),
    });
    expect(assertCodexBundle()).toMatchObject({ binaryPath });
  });

  it('fails without falling back to a PATH/global codex binary', async () => {
    const { getCodexBundle, assertCodexBundle } = await import('@electron/runtime/codex-paths');

    const candidate = getCodexBundle();
    expect(candidate.binaryPath).toContain(join('build', 'codex', `${process.platform}-${process.arch}`, 'bin'));
    expect(candidate.binaryPath).not.toBe('codex');
    expect(() => assertCodexBundle()).toThrow('pnpm run bundle:codex:current');
  });
});

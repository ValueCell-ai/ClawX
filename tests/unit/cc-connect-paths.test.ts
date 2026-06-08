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

describe('cc-connect path resolver', () => {
  const originalCwd = process.cwd();
  const originalOverride = process.env.CLAWX_CC_CONNECT_PATH;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.CLAWX_CC_CONNECT_PATH;
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-paths-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalOverride === undefined) {
      delete process.env.CLAWX_CC_CONNECT_PATH;
    } else {
      process.env.CLAWX_CC_CONNECT_PATH = originalOverride;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses the dev bundled cc-connect binary when node_modules postinstall did not create one', async () => {
    const binaryName = process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect';
    const bundledPath = join(process.cwd(), 'build', 'cc-connect', `${process.platform}-${process.arch}`, binaryName);
    await mkdir(join(bundledPath, '..'), { recursive: true });
    await writeFile(bundledPath, 'mock cc-connect', 'utf8');
    await chmod(bundledPath, 0o755);

    const { getCcConnectBinaryPath, assertCcConnectBinaryPath } = await import('@electron/runtime/cc-connect-paths');

    expect(getCcConnectBinaryPath()).toBe(bundledPath);
    expect(assertCcConnectBinaryPath()).toBe(bundledPath);
  });

  it('does not use the npm postinstall binary as a runtime fallback', async () => {
    const binaryName = process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect';
    const nodeModulesBinary = join(process.cwd(), 'node_modules', 'cc-connect', 'bin', binaryName);
    await mkdir(join(nodeModulesBinary, '..'), { recursive: true });
    await writeFile(nodeModulesBinary, 'mock cc-connect from node_modules', 'utf8');
    await chmod(nodeModulesBinary, 0o755);

    const { getCcConnectBinaryPath, assertCcConnectBinaryPath } = await import('@electron/runtime/cc-connect-paths');

    expect(getCcConnectBinaryPath()).toContain(join('build', 'cc-connect', `${process.platform}-${process.arch}`));
    expect(getCcConnectBinaryPath()).not.toBe(nodeModulesBinary);
    expect(() => assertCcConnectBinaryPath()).toThrow('pnpm run bundle:cc-connect:current');
  });
});

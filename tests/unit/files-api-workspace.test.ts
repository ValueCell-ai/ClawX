// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, realpath, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  home: '',
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  beforeOpen: undefined as undefined | ((path: string) => void | Promise<void>),
  beforeRealpath: undefined as undefined | ((path: string) => void | Promise<void>),
  afterStat: undefined as undefined | ((path: string) => void | Promise<void>),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mocks.home || actual.homedir() };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/clawx-user-data') },
  nativeImage: { createFromPath: vi.fn() },
  shell: {
    openPath: mocks.openPath,
    showItemInFolder: mocks.showItemInFolder,
  },
}));

describe('workspace-scoped files api', () => {
  let testDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    mocks.openPath.mockReset().mockResolvedValue('');
    mocks.showItemInFolder.mockReset();
    mocks.beforeOpen = undefined;
    mocks.beforeRealpath = undefined;
    mocks.afterStat = undefined;
    testDir = await mkdtemp(join(tmpdir(), 'clawx-files-workspace-'));
    mocks.home = testDir;
    workspaceRoot = join(testDir, '.openclaw', 'workspace');
    await mkdir(join(workspaceRoot, 'projects', 'demo'), { recursive: true });
    await writeFile(join(workspaceRoot, 'hello.txt'), 'hello', 'utf8');
    await writeFile(join(workspaceRoot, 'image.bin'), Buffer.from([1, 2, 3]));
  });

  afterEach(async () => {
    mocks.home = '';
    await rm(testDir, { recursive: true, force: true });
  });

  async function getApi() {
    const { createFilesApi } = await import('../../electron/services/files-api');
    return createFilesApi({
      workspaceFs: {
        open: async (path, flags) => {
          await mocks.beforeOpen?.(path);
          return open(path, flags);
        },
        realpath: async (path) => {
          await mocks.beforeRealpath?.(path);
          return realpath(path);
        },
        stat: async (path) => {
          const result = await stat(path);
          await mocks.afterStat?.(path);
          return result;
        },
      },
    });
  }

  it('does not expose path-only scoped shell capabilities', async () => {
    const api = await getApi();

    expect(api).not.toHaveProperty('openWorkspaceFile');
    expect(api).not.toHaveProperty('revealWorkspaceFile');
  });

  it('expands and canonicalizes workspace context and requires cwd containment', async () => {
    const api = await getApi();
    const canonicalRoot = await realpath(workspaceRoot);
    const canonicalCwd = await realpath(join(workspaceRoot, 'projects', 'demo'));

    await expect(api.resolveWorkspaceContext({
      workspaceRoot: '~/.openclaw/workspace',
      executionCwd: '~/.openclaw/workspace/projects/demo',
    })).resolves.toEqual({
      ok: true,
      workspaceRoot: canonicalRoot,
      executionCwd: canonicalCwd,
    });

    await expect(api.resolveWorkspaceContext({
      workspaceRoot: join(testDir, 'missing'),
      executionCwd: join(testDir, 'missing'),
    })).resolves.toEqual({ ok: false, error: 'notFound' });

    const fileRoot = join(testDir, 'file-root');
    await writeFile(fileRoot, 'not a directory');
    await expect(api.resolveWorkspaceContext({
      workspaceRoot: fileRoot,
      executionCwd: fileRoot,
    })).resolves.toEqual({ ok: false, error: 'notDirectory' });

    await expect(api.resolveWorkspaceContext({
      workspaceRoot,
      executionCwd: testDir,
    })).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
  });

  it('reads text and binary files and stats normal children', async () => {
    const api = await getApi();
    const textRef = { workspaceRoot, relativePath: 'hello.txt' };

    await expect(api.readWorkspaceText(textRef)).resolves.toMatchObject({
      ok: true,
      content: 'hello',
      size: 5,
      readOnly: true,
    });
    await expect(api.readWorkspaceBinary({ workspaceRoot, relativePath: 'image.bin' })).resolves.toMatchObject({
      ok: true,
      data: new Uint8Array([1, 2, 3]),
      size: 3,
      readOnly: true,
    });
    await expect(api.statWorkspaceFile(textRef)).resolves.toMatchObject({
      ok: true,
      isFile: true,
      isDir: false,
      size: 5,
      readOnly: true,
    });
  });

  it.each([
    ['', 'hello.txt'],
    ['   ', 'hello.txt'],
    ['ROOT', ''],
    ['ROOT', '   '],
    ['ROOT', '../outside.txt'],
    ['ROOT', 'child/../../outside.txt'],
    ['ROOT', '/tmp/absolute.txt'],
  ])('rejects invalid root/path inputs (%s, %s)', async (root, relativePath) => {
    const api = await getApi();
    await expect(api.readWorkspaceText({
      workspaceRoot: root === 'ROOT' ? workspaceRoot : root,
      relativePath,
    })).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
  });

  it('rejects root-prefix collisions on POSIX and case-insensitive Windows paths', async () => {
    const { isPathInside } = await import('../../electron/services/files-api');

    expect(isPathInside('/workspace/root/child', '/workspace/root', 'linux')).toBe(true);
    expect(isPathInside('/workspace/rooted/child', '/workspace/root', 'linux')).toBe(false);
    expect(isPathInside('C:\\Work\\Root\\child.txt', 'c:\\work\\root', 'win32')).toBe(true);
    expect(isPathInside('C:\\child.txt', 'C:\\', 'win32')).toBe(true);
    expect(isPathInside('C:\\Work\\Rooted\\child.txt', 'c:\\work\\root', 'win32')).toBe(false);
    expect(isPathInside('D:\\Work\\Root\\child.txt', 'c:\\work\\root', 'win32')).toBe(false);
  });

  it('validates traversal independently for every workspace target operation', async () => {
    const api = await getApi();
    const invalid = { workspaceRoot, relativePath: '../outside.txt' };

    await expect(api.readWorkspaceText(invalid)).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    await expect(api.readWorkspaceBinary(invalid)).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    await expect(api.statWorkspaceFile(invalid)).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    expect(mocks.openPath).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('rejects existing targets and parent symlinks that escape the root', async () => {
    const outsideDir = join(testDir, 'outside');
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
    await symlink(join(outsideDir, 'secret.txt'), join(workspaceRoot, 'file-link'));
    await symlink(outsideDir, join(workspaceRoot, 'dir-link'));
    const api = await getApi();

    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'file-link' }))
      .resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'dir-link/secret.txt' }))
      .resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'dir-link/missing.txt' }))
      .resolves.toEqual({ ok: false, error: 'outsideSandbox' });
  });

  it('returns notFound for a missing leaf below a safe canonical parent', async () => {
    const api = await getApi();

    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'projects/demo/missing.txt' }))
      .resolves.toEqual({ ok: false, error: 'notFound' });
  });

  it('retains text and binary read size limits', async () => {
    const textPath = join(workspaceRoot, 'large.txt');
    const binaryPath = join(workspaceRoot, 'large.bin');
    await writeFile(textPath, '');
    await writeFile(binaryPath, '');
    await truncate(textPath, 2 * 1024 * 1024 + 1);
    await truncate(binaryPath, 17);
    const api = await getApi();

    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'large.txt' }))
      .resolves.toMatchObject({ ok: false, error: 'tooLarge', size: 2 * 1024 * 1024 + 1 });
    await expect(api.readWorkspaceBinary({ workspaceRoot, relativePath: 'large.bin', maxBytes: 16 }))
      .resolves.toMatchObject({ ok: false, error: 'tooLarge', size: 17 });
  });

  it('does not read a replacement swapped in after path stat', async () => {
    const parent = join(workspaceRoot, 'stat-race');
    const movedParent = join(workspaceRoot, 'stat-race-original');
    const outsideParent = join(testDir, 'stat-race-outside');
    const target = join(parent, 'target.txt');
    await mkdir(parent);
    await mkdir(outsideParent);
    await writeFile(target, 'safe');
    await writeFile(join(outsideParent, 'target.txt'), 'outside-secret');
    const canonicalTarget = await realpath(target);
    let swapped = false;
    mocks.afterStat = async (path) => {
      if (path !== canonicalTarget || swapped) return;
      swapped = true;
      await rename(parent, movedParent);
      await symlink(outsideParent, parent);
    };
    const api = await getApi();

    const result = await api.readWorkspaceText({ workspaceRoot, relativePath: 'stat-race/target.txt' });

    expect(swapped).toBe(true);
    expect(result.content).not.toBe('outside-secret');
    expect(JSON.stringify(result)).not.toContain(outsideParent);
  });

  it('rejects a parent swapped outside after validation but before file open', async () => {
    const parent = join(workspaceRoot, 'open-race');
    const movedParent = join(workspaceRoot, 'open-race-original');
    const outsideParent = join(testDir, 'open-race-outside');
    const target = join(parent, 'target.txt');
    await mkdir(parent);
    await mkdir(outsideParent);
    await writeFile(target, 'safe');
    await writeFile(join(outsideParent, 'target.txt'), 'outside-secret');
    const canonicalTarget = await realpath(target);
    let swapped = false;
    mocks.beforeOpen = async (path) => {
      if (path !== canonicalTarget || swapped) return;
      swapped = true;
      await rename(parent, movedParent);
      await symlink(outsideParent, parent);
    };
    const api = await getApi();

    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'open-race/target.txt' }))
      .resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    expect(swapped).toBe(true);
  });

  it('bounds handle reads when a file grows after the identity check', async () => {
    const target = join(workspaceRoot, 'growing.txt');
    await writeFile(target, 'safe');
    const canonicalTarget = await realpath(target);
    let grew = false;
    mocks.afterStat = async (path) => {
      if (path !== canonicalTarget || grew) return;
      grew = true;
      await truncate(target, 2 * 1024 * 1024 + 1);
    };
    const api = await getApi();

    await expect(api.readWorkspaceText({ workspaceRoot, relativePath: 'growing.txt' }))
      .resolves.toMatchObject({ ok: false, error: 'tooLarge' });
    expect(grew).toBe(true);
  });

  it('maps filesystem failures to safe errors without absolute paths', async () => {
    const api = await getApi();
    const canonicalTarget = await realpath(join(workspaceRoot, 'hello.txt'));
    mocks.beforeRealpath = async (path) => {
      if (path === canonicalTarget) {
        throw new Error(`permission denied: ${workspaceRoot}`);
      }
    };

    const fsResult = await api.readWorkspaceText({ workspaceRoot, relativePath: 'hello.txt' });
    expect(fsResult).toEqual({ ok: false, error: 'operationFailed' });
    expect(JSON.stringify(fsResult)).not.toContain(workspaceRoot);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['non-number', '16'],
  ])('falls back to the binary default for malformed %s maxBytes', async (_label, maxBytes) => {
    const target = join(workspaceRoot, 'over-default.bin');
    await writeFile(target, '');
    await truncate(target, 50 * 1024 * 1024 + 1);
    const api = await getApi();

    await expect(api.readWorkspaceBinary({
      workspaceRoot,
      relativePath: 'over-default.bin',
      maxBytes,
    } as never)).resolves.toMatchObject({
      ok: false,
      error: 'tooLarge',
      size: 50 * 1024 * 1024 + 1,
    });
  });
});

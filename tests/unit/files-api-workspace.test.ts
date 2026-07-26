// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  home: '',
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
  listOpenHandlers: vi.fn(),
  openWithHandler: vi.fn(),
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
    mocks.listOpenHandlers.mockReset().mockResolvedValue([]);
    mocks.openWithHandler.mockReset().mockResolvedValue(undefined);
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
      openWith: {
        platform: 'darwin',
        list: mocks.listOpenHandlers,
        open: mocks.openWithHandler,
      },
    });
  }

  it('registers every staged file id with Main-owned staging storage', async () => {
    const { StagedAttachmentRegistry } = await import('../../electron/services/attachment-access');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const stagedAttachments = new StagedAttachmentRegistry();
    const api = createFilesApi({ stagedAttachments });

    const result = await api.stageBuffer({
      base64: Buffer.from('staged text').toString('base64'),
      fileName: 'staged.txt',
      mimeType: 'text/plain',
    });
    const [pathResult] = await api.stagePaths({ filePaths: [join(workspaceRoot, 'hello.txt')] });

    expect(stagedAttachments.get(result.id)).toBe(await realpath(result.stagedPath));
    expect(stagedAttachments.get(pathResult.id)).toBe(await realpath(pathResult.stagedPath));
    expect(stagedAttachments.getDisplayPath(result.id)).toBeNull();
    expect(stagedAttachments.getDisplayPath(pathResult.id)).toBe(join(workspaceRoot, 'hello.txt'));
    expect(result.stagedPath).toContain(join('media', 'outbound', 'clawx-staging'));
    expect(pathResult.stagedPath).toContain(join('media', 'outbound', 'clawx-staging'));
  });

  it.each(['buffer', 'path'])('rejects a %s stage when the pinned staging directory is replaced', async (kind) => {
    const { StagedAttachmentRegistry } = await import('../../electron/services/attachment-access');
    const { createFilesApi } = await import('../../electron/services/files-api');
    const stagedAttachments = new StagedAttachmentRegistry();
    const register = vi.spyOn(stagedAttachments, 'register');
    const outsideDir = join(testDir, `outside-stage-${kind}`);
    await mkdir(outsideDir);
    const api = createFilesApi({
      stagedAttachments,
      stagingHooks: {
        beforeDestinationOpen: async ({ stagingDir }) => {
          await rename(stagingDir, `${stagingDir}-moved`);
          await symlink(outsideDir, stagingDir);
        },
      },
    } as never);

    const operation = kind === 'buffer'
      ? api.stageBuffer({
          base64: Buffer.from('must not escape').toString('base64'),
          fileName: 'escape.txt',
          mimeType: 'text/plain',
        })
      : api.stagePaths({ filePaths: [join(workspaceRoot, 'hello.txt')] });

    await expect(operation).rejects.toThrow();
    expect(register).not.toHaveBeenCalled();
    expect(await readdir(outsideDir)).toEqual([]);
  });

  it('lists, opens, and reveals a regular workspace file through scoped services', async () => {
    const canonicalTarget = await realpath(join(workspaceRoot, 'hello.txt'));
    const ref = { workspaceRoot, relativePath: 'hello.txt' };
    const handlerId = 'opaque:handler:4f2a';
    mocks.listOpenHandlers.mockResolvedValueOnce([{
      id: handlerId,
      name: 'Text Reader',
      isDefault: true,
    }]);
    mocks.openWithHandler.mockImplementationOnce(async (initialPath, selectedHandlerId, revalidateFile) => {
      expect(initialPath).toBe(canonicalTarget);
      expect(selectedHandlerId).toBe(handlerId);
      await expect(revalidateFile()).resolves.toBe(canonicalTarget);
    });
    const api = await getApi();

    await expect(api.listWorkspaceOpenHandlers(ref)).resolves.toEqual({
      ok: true,
      platform: 'darwin',
      handlers: [{ handlerId, name: 'Text Reader', isDefault: true }],
    });
    await expect(api.openWorkspaceWith({ ref, handlerId })).resolves.toEqual({ ok: true });
    await expect(api.revealWorkspaceFile(ref)).resolves.toEqual({ ok: true });

    expect(mocks.listOpenHandlers).toHaveBeenCalledWith(canonicalTarget);
    expect(mocks.openWithHandler).toHaveBeenCalledWith(
      canonicalTarget,
      handlerId,
      expect.any(Function),
    );
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(canonicalTarget);
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('rejects non-files, traversal, and symlink escapes for every workspace native action', async () => {
    const outsideDir = join(testDir, 'native-action-outside');
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
    await symlink(join(outsideDir, 'secret.txt'), join(workspaceRoot, 'escaped-file'));
    const api = await getApi();
    const cases = [
      [{ workspaceRoot, relativePath: 'projects' }, 'notFile'],
      [{ workspaceRoot, relativePath: '../outside.txt' }, 'outsideSandbox'],
      [{ workspaceRoot, relativePath: 'escaped-file' }, 'outsideSandbox'],
    ] as const;

    for (const [ref, error] of cases) {
      await expect(api.listWorkspaceOpenHandlers(ref)).resolves.toEqual({ ok: false, error });
      await expect(api.openWorkspaceWith({ ref, handlerId: 'opaque-handler-id' }))
        .resolves.toEqual({ ok: false, error });
      await expect(api.revealWorkspaceFile(ref)).resolves.toEqual({ ok: false, error });
    }

    expect(mocks.listOpenHandlers).not.toHaveBeenCalled();
    expect(mocks.openWithHandler).not.toHaveBeenCalled();
    expect(mocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('revalidates the workspace target after handler selection and before native open', async () => {
    const target = join(workspaceRoot, 'open-with-race.txt');
    const outsideTarget = join(testDir, 'open-with-race-secret.txt');
    await writeFile(target, 'safe');
    await writeFile(outsideTarget, 'outside-secret');
    const canonicalTarget = await realpath(target);
    const nativeOpen = vi.fn();
    mocks.openWithHandler.mockImplementationOnce(async (initialPath, _handlerId, revalidateFile) => {
      expect(initialPath).toBe(canonicalTarget);
      await rm(target);
      await symlink(outsideTarget, target);
      await revalidateFile();
      nativeOpen();
    });
    const api = await getApi();

    await expect(api.openWorkspaceWith({
      ref: { workspaceRoot, relativePath: 'open-with-race.txt' },
      handlerId: 'opaque-handler-id',
    })).resolves.toEqual({ ok: false, error: 'outsideSandbox' });
    expect(mocks.openWithHandler).toHaveBeenCalledWith(
      canonicalTarget,
      'opaque-handler-id',
      expect.any(Function),
    );
    expect(nativeOpen).not.toHaveBeenCalled();
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

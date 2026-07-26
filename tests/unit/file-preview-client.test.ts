import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  files: {
    resolveWorkspaceContext: vi.fn(),
    readWorkspaceText: vi.fn(),
    readWorkspaceBinary: vi.fn(),
    statWorkspaceFile: vi.fn(),
    readText: vi.fn(),
    readBinary: vi.fn(),
    writeText: vi.fn(),
    stat: vi.fn(),
    listDir: vi.fn(),
    listTree: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

import {
  listDir,
  listTree,
  readBinaryFile,
  readTextFile,
  readWorkspaceBinary,
  readWorkspaceText,
  resolveWorkspaceContext,
  statFile,
  statWorkspaceFile,
  writeTextFile,
} from '@/lib/file-preview-client';
import { buildPreviewTarget, buildWorkspacePreviewTarget } from '@/components/file-preview/build-preview-target';
import { getFilePreviewTargetIdentity } from '@/components/file-preview/types';

describe('file-preview-client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('delegates file preview helpers through hostApi.files', async () => {
    hostApiMock.files.readText.mockResolvedValueOnce({ ok: true, content: 'hello' });
    hostApiMock.files.readBinary.mockResolvedValueOnce({ ok: true, data: new Uint8Array([1]) });
    hostApiMock.files.writeText.mockResolvedValueOnce({ ok: true });
    hostApiMock.files.stat.mockResolvedValueOnce({ ok: true, isFile: true, size: 5 });
    hostApiMock.files.listDir.mockResolvedValueOnce({ ok: true, entries: [] });
    hostApiMock.files.listTree.mockResolvedValueOnce({
      ok: true,
      root: { name: 'root', relPath: '', absPath: '/tmp', isDir: true },
    });

    await expect(readTextFile('/tmp/a.txt')).resolves.toEqual({ ok: true, content: 'hello' });
    await expect(readBinaryFile('/tmp/b.png', { maxBytes: 32 })).resolves.toEqual({
      ok: true,
      data: new Uint8Array([1]),
    });
    await expect(writeTextFile('/tmp/a.txt', 'updated')).resolves.toEqual({ ok: true });
    await expect(statFile('/tmp/a.txt')).resolves.toEqual({ ok: true, isFile: true, size: 5 });
    await expect(listDir('/tmp')).resolves.toEqual({ ok: true, entries: [] });
    await expect(listTree('/tmp', { maxDepth: 2 })).resolves.toEqual({
      ok: true,
      root: { name: 'root', relPath: '', absPath: '/tmp', isDir: true },
    });

    expect(hostApiMock.files.readText).toHaveBeenCalledWith('/tmp/a.txt');
    expect(hostApiMock.files.readBinary).toHaveBeenCalledWith('/tmp/b.png', { maxBytes: 32 });
    expect(hostApiMock.files.writeText).toHaveBeenCalledWith('/tmp/a.txt', 'updated');
    expect(hostApiMock.files.stat).toHaveBeenCalledWith('/tmp/a.txt');
    expect(hostApiMock.files.listDir).toHaveBeenCalledWith('/tmp');
    expect(hostApiMock.files.listTree).toHaveBeenCalledWith('/tmp', { maxDepth: 2 });
  });

  it('delegates workspace-scoped helpers with exact typed payloads', async () => {
    const context = { workspaceRoot: '~/.openclaw/workspace', executionCwd: 'projects/demo' };
    const ref = { workspaceRoot: '/workspace', relativePath: 'src/index.ts' };
    const binaryInput = { ...ref, maxBytes: 1024 };
    hostApiMock.files.resolveWorkspaceContext.mockResolvedValueOnce({
      ok: true,
      workspaceRoot: '/workspace',
      executionCwd: '/workspace/projects/demo',
    });
    hostApiMock.files.readWorkspaceText.mockResolvedValueOnce({ ok: true, content: 'text' });
    hostApiMock.files.readWorkspaceBinary.mockResolvedValueOnce({ ok: true, data: new Uint8Array([1]) });
    hostApiMock.files.statWorkspaceFile.mockResolvedValueOnce({ ok: true, isFile: true });

    await resolveWorkspaceContext(context);
    await readWorkspaceText(ref);
    await readWorkspaceBinary(binaryInput);
    await statWorkspaceFile(ref);

    expect(hostApiMock.files.resolveWorkspaceContext).toHaveBeenCalledWith(context);
    expect(hostApiMock.files.readWorkspaceText).toHaveBeenCalledWith(ref);
    expect(hostApiMock.files.readWorkspaceBinary).toHaveBeenCalledWith(binaryInput);
    expect(hostApiMock.files.statWorkspaceFile).toHaveBeenCalledWith(ref);
  });

  it('builds scoped preview targets without exposing an absolute target path', () => {
    const ref = { workspaceRoot: '/secret/workspace', relativePath: String.raw`reports\weekly.pdf` };

    expect(buildWorkspacePreviewTarget(ref, { size: 42 })).toEqual({
      workspaceFileRef: ref,
      filePath: 'reports/weekly.pdf',
      fileName: 'weekly.pdf',
      ext: '.pdf',
      mimeType: 'application/pdf',
      contentType: 'document',
      size: 42,
    });
    expect(buildWorkspacePreviewTarget(ref).filePath).not.toContain(ref.workspaceRoot);
  });

  it('keeps trusted preview target behavior unchanged', () => {
    expect(buildPreviewTarget('/tmp/demo.txt')).toEqual({
      filePath: '/tmp/demo.txt',
      fileName: 'demo.txt',
      ext: '.txt',
      mimeType: 'text/plain',
      contentType: 'document',
      size: undefined,
    });
  });

  it('identifies scoped targets by workspace root and relative path without changing display paths', () => {
    const first = buildWorkspacePreviewTarget({
      workspaceRoot: '/workspace-a',
      relativePath: 'src/index.ts',
    });
    const second = buildWorkspacePreviewTarget({
      workspaceRoot: '/workspace-b',
      relativePath: 'src/index.ts',
    });

    expect(first.filePath).toBe('src/index.ts');
    expect(second.filePath).toBe('src/index.ts');
    expect(getFilePreviewTargetIdentity(first)).not.toBe(getFilePreviewTargetIdentity(second));
    expect(getFilePreviewTargetIdentity(buildPreviewTarget('/tmp/index.ts'))).toBe('trusted:/tmp/index.ts');
  });
});

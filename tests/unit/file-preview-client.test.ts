import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  files: {
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
  statFile,
  writeTextFile,
} from '@/lib/file-preview-client';

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
});

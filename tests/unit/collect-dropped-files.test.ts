import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectDroppedFiles,
  getElectronFilePath,
  inferExpandedFolderDropRoot,
} from '@/lib/collect-dropped-files';

function makeFile(
  name: string,
  options?: {
    path?: string;
    webkitRelativePath?: string;
    type?: string;
    size?: number;
  },
): File {
  const file = new File(
    [new Uint8Array(options?.size ?? 0)],
    name,
    { type: options?.type ?? '' },
  );
  if (options?.path) {
    Object.defineProperty(file, 'path', { value: options.path });
  }
  if (options?.webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: options.webkitRelativePath });
  }
  return file;
}

describe('collect-dropped-files', () => {
  beforeEach(() => {
    window.electron.platform = 'darwin';
    vi.mocked(window.electron.getPathForFile).mockImplementation(
      (file) => (file as File & { path?: string }).path ?? '',
    );
  });

  it('resolves macOS folder drops through getPathForFile', () => {
    const folderFile = makeFile('Archive', {
      path: '/Users/me/Downloads/Archive',
      type: 'application/zip',
      size: 192,
    });

    const result = collectDroppedFiles({
      items: [{
        kind: 'file',
        getAsFile: () => folderFile,
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name: 'Archive' }),
      }],
      files: [folderFile],
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual(['/Users/me/Downloads/Archive']);
    expect(result.bufferFiles).toEqual([]);
  });

  it('collapses Windows expanded folder drops into a single directory path', () => {
    window.electron.platform = 'win32';

    const files = [
      makeFile('a.txt', {
        path: 'C:\\Users\\me\\Downloads\\Project\\a.txt',
        webkitRelativePath: 'Project\\a.txt',
      }),
      makeFile('b.txt', {
        path: 'C:\\Users\\me\\Downloads\\Project\\sub\\b.txt',
        webkitRelativePath: 'Project\\sub\\b.txt',
      }),
    ];

    const result = collectDroppedFiles({
      items: [],
      files,
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual(['C:\\Users\\me\\Downloads\\Project']);
    expect(result.bufferFiles).toEqual([]);
  });

  it('handles Unicode folder names on Windows expanded folder drops', () => {
    window.electron.platform = 'win32';

    const files = [
      makeFile('说明.txt', {
        path: 'C:\\Users\\张三\\Downloads\\我的项目\\说明.txt',
        webkitRelativePath: '我的项目\\说明.txt',
      }),
      makeFile('笔记.txt', {
        path: 'C:\\Users\\张三\\Downloads\\我的项目\\docs\\笔记.txt',
        webkitRelativePath: '我的项目\\docs\\笔记.txt',
      }),
    ];

    const result = collectDroppedFiles({
      items: [],
      files,
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual(['C:\\Users\\张三\\Downloads\\我的项目']);
    expect(result.bufferFiles).toEqual([]);
  });

  it('handles Unicode folder names on macOS directory drops', () => {
    const folderFile = makeFile('我的文件夹', {
      path: '/Users/zhonghaolu/Downloads/我的文件夹',
      size: 192,
    });

    const result = collectDroppedFiles({
      items: [{
        kind: 'file',
        getAsFile: () => folderFile,
        webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name: '我的文件夹' }),
      }],
      files: [folderFile],
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual(['/Users/zhonghaolu/Downloads/我的文件夹']);
    expect(result.bufferFiles).toEqual([]);
  });

  it('deduplicates Windows paths regardless of drive-letter casing', () => {
    window.electron.platform = 'win32';

    const first = makeFile('Project', { path: 'C:\\Data\\Project' });
    const second = makeFile('Project', { path: 'c:\\data\\project' });

    const result = collectDroppedFiles({
      items: [
        { kind: 'file', getAsFile: () => first, webkitGetAsEntry: () => null },
        { kind: 'file', getAsFile: () => second, webkitGetAsEntry: () => null },
      ],
      files: [first, second],
    } as unknown as DataTransfer);

    expect(result.pathFiles).toHaveLength(1);
  });

  it('keeps regular file drops on the path staging path', () => {
    const file = makeFile('note.txt', { path: '/tmp/note.txt' });

    const result = collectDroppedFiles({
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null }],
      files: [file],
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual(['/tmp/note.txt']);
    expect(result.bufferFiles).toEqual([]);
  });

  it('falls back to buffer staging when no native path is available', () => {
    vi.mocked(window.electron.getPathForFile).mockReturnValue('');
    const file = makeFile('blob.bin', { size: 8 });

    const result = collectDroppedFiles({
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => null }],
      files: [file],
    } as unknown as DataTransfer);

    expect(result.pathFiles).toEqual([]);
    expect(result.bufferFiles).toEqual([file]);
  });
});

describe('inferExpandedFolderDropRoot', () => {
  it('returns null for unrelated file selections', () => {
    const files = [
      makeFile('a.txt', { path: 'C:\\tmp\\a.txt', webkitRelativePath: 'a.txt' }),
      makeFile('b.txt', { path: 'C:\\tmp\\b.txt', webkitRelativePath: 'b.txt' }),
    ];

    expect(inferExpandedFolderDropRoot(files)).toBeNull();
  });

  it('prefers getPathForFile over legacy File.path', () => {
    const file = makeFile('Archive', { path: '/legacy/path' });
    vi.mocked(window.electron.getPathForFile).mockReturnValueOnce('/preferred/path');

    expect(getElectronFilePath(file)).toBe('/preferred/path');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { symlinkSyncMock } = vi.hoisted(() => ({ symlinkSyncMock: vi.fn() }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const mocked = {
    ...actual,
    symlinkSync: (...args: unknown[]) => symlinkSyncMock(...args),
  };
  return { ...mocked, default: mocked };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mocked = {
    ...actual,
    symlinkSync: (...args: unknown[]) => symlinkSyncMock(...args),
  };
  return { ...mocked, default: mocked };
});

describe('fs-link', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    symlinkSyncMock.mockReset();
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  describe('linkDirSafe', () => {
    it('creates a plain dir symlink on POSIX and passes paths through unchanged', async () => {
      setPlatform('darwin');
      vi.resetModules();
      const { linkDirSafe } = await import('@electron/gateway/fs-link');

      linkDirSafe('/src/a', '/dest/a');

      expect(symlinkSyncMock).toHaveBeenCalledTimes(1);
      expect(symlinkSyncMock).toHaveBeenCalledWith('/src/a', '/dest/a', 'dir');
    });

    it('prefers junction on Windows and normalizes paths with the extended prefix', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { linkDirSafe } = await import('@electron/gateway/fs-link');

      linkDirSafe('C:/foo/bar', 'C:/baz/qux');

      expect(symlinkSyncMock).toHaveBeenCalledTimes(1);
      expect(symlinkSyncMock).toHaveBeenCalledWith(
        '\\\\?\\C:\\foo\\bar',
        '\\\\?\\C:\\baz\\qux',
        'junction',
      );
    });

    it('falls back to symlink when junction creation throws on Windows', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { linkDirSafe } = await import('@electron/gateway/fs-link');

      symlinkSyncMock.mockImplementationOnce(() => {
        throw new Error('EXDEV: cross-volume junction not supported');
      });

      linkDirSafe('C:/foo', 'D:/bar');

      expect(symlinkSyncMock).toHaveBeenCalledTimes(2);
      const [firstCall, secondCall] = symlinkSyncMock.mock.calls;
      expect(firstCall[2]).toBe('junction');
      expect(secondCall[2]).toBe('dir');
    });

    it('rethrows when both junction and symlink fail on Windows', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { linkDirSafe } = await import('@electron/gateway/fs-link');

      symlinkSyncMock.mockImplementation(() => {
        throw new Error('EPERM');
      });

      expect(() => linkDirSafe('C:/foo', 'C:/bar')).toThrow('EPERM');
      expect(symlinkSyncMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('normalizeFsPath', () => {
    it('passes POSIX paths through unchanged', async () => {
      setPlatform('linux');
      vi.resetModules();
      const { normalizeFsPath } = await import('@electron/gateway/fs-link');

      expect(normalizeFsPath('/a/b/c')).toBe('/a/b/c');
      expect(normalizeFsPath('')).toBe('');
    });

    it('adds the \\\\?\\ prefix on Windows for absolute drive paths', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { normalizeFsPath } = await import('@electron/gateway/fs-link');

      expect(normalizeFsPath('C:/a/b')).toBe('\\\\?\\C:\\a\\b');
    });

    it('adds the UNC extended prefix for UNC paths on Windows', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { normalizeFsPath } = await import('@electron/gateway/fs-link');

      expect(normalizeFsPath('//server/share/file')).toBe('\\\\?\\UNC\\server\\share\\file');
    });

    it('does not double-prefix already-normalized Windows paths', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { normalizeFsPath } = await import('@electron/gateway/fs-link');

      const already = '\\\\?\\C:\\x\\y';
      expect(normalizeFsPath(already)).toBe(already);
    });

    it('leaves relative Windows paths un-prefixed', async () => {
      setPlatform('win32');
      vi.resetModules();
      const { normalizeFsPath } = await import('@electron/gateway/fs-link');

      expect(normalizeFsPath('a/b')).toBe('a\\b');
    });
  });
});

import { symlinkSync } from 'fs';
import path from 'path';

/**
 * Normalize a filesystem path for the current platform. On Windows, convert
 * forward slashes to backslashes and apply the `\\?\` extended-length prefix
 * for absolute paths so long paths are handled correctly. On POSIX, return
 * the path unchanged.
 */
export function normalizeFsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}

/**
 * Create a directory link from `src` to `dest`.
 *
 * On POSIX uses a regular symlink. On Windows prefers a junction (which does
 * not require Developer Mode or administrator privileges) and falls back to
 * a regular symlink only if the junction attempt fails.
 *
 * Throws on POSIX when symlink creation fails. On Windows, both attempts
 * failing will throw the symlink error — callers guard with try/catch when
 * link creation is non-fatal (e.g. optional extension dependency linking).
 */
export function linkDirSafe(src: string, dest: string): void {
  const isWin = process.platform === 'win32';
  const srcP = normalizeFsPath(src);
  const destP = normalizeFsPath(dest);
  if (!isWin) {
    symlinkSync(srcP, destP, 'dir');
    return;
  }
  try {
    symlinkSync(srcP, destP, 'junction');
  } catch {
    // Junction failed (e.g. cross-volume). Try a symlink as a last resort.
    symlinkSync(srcP, destP, 'dir');
  }
}

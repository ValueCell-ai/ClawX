import { dirname, join } from 'node:path';
import { lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';

function normalizeComparablePath(input: string): string {
  if (process.platform === 'win32') {
    return input.replace(/\\/g, '/').toLowerCase();
  }
  return input;
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeComparablePath(root);
  const normalizedCandidate = normalizeComparablePath(candidate);
  const rootWithSep = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootWithSep);
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object'
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function resolveRealPath(input: string): string {
  // Node's JavaScript realpath implementation can split a Windows namespaced
  // path (\\?\C:\...) at the drive colon and try to lstat "C:". The native
  // implementation accepts the same long-path form without reparsing it.
  return realpathSync.native(input);
}

function removeLinkEntry(entryPath: string): void {
  // Never recursively remove a link. In particular, an NTFS junction may point
  // at the bundled OpenClaw runtime outside the plugin tree.
  try {
    unlinkSync(entryPath);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') return;
    // libuv normally unlinks Windows junctions directly. Some Windows filesystems
    // report directory links as EPERM/EISDIR, where a non-recursive rmdir removes
    // the junction node without traversing its target.
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EISDIR')) {
      rmdirSync(entryPath);
      return;
    }
    throw error;
  }
}

function removeFileEntry(entryPath: string): void {
  try {
    unlinkSync(entryPath);
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error;
  }
}

function removeDirectoryEntry(entryPath: string, deletionRootRealPath: string): void {
  let stat;
  try {
    stat = lstatSync(entryPath);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    removeLinkEntry(entryPath);
    return;
  }

  if (stat.isDirectory()) {
    // Resolve before descending. If resolution fails, propagate the error rather
    // than falling back to fs.rmSync(), which could follow an outbound junction.
    const entryRealPath = resolveRealPath(entryPath);
    if (!isPathInside(deletionRootRealPath, entryRealPath)) {
      throw new Error(`Refusing to recursively delete directory outside root: ${entryPath} -> ${entryRealPath}`);
    }

    for (const child of readdirSync(entryPath)) {
      removeDirectoryEntry(join(entryPath, child), deletionRootRealPath);
    }
    rmdirSync(entryPath);
    return;
  }

  removeFileEntry(entryPath);
}

/**
 * Remove a file or directory tree without following outbound directory
 * junctions/symlinks on Windows. Plain fs.rmSync({ recursive: true }) can
 * traverse NTFS junctions (for example plugin node_modules/openclaw peers)
 * and delete link targets outside the requested tree.
 */
export function safeRmSync(targetPath: string): void {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    removeLinkEntry(targetPath);
    return;
  }

  if (!stat.isDirectory()) {
    removeFileEntry(targetPath);
    return;
  }

  // Fail closed when either path cannot be resolved. Falling back to recursive
  // rm here would reintroduce the junction traversal this helper prevents.
  const parentRealPath = resolveRealPath(dirname(targetPath));
  const deletionRootRealPath = resolveRealPath(targetPath);
  if (!isPathInside(parentRealPath, deletionRootRealPath)) {
    throw new Error(`Refusing to recursively delete directory outside parent: ${targetPath} -> ${deletionRootRealPath}`);
  }

  for (const child of readdirSync(targetPath)) {
    removeDirectoryEntry(join(targetPath, child), deletionRootRealPath);
  }

  rmdirSync(targetPath);
}

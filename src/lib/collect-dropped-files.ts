const DIRECTORY_MIME_TYPE = 'application/x-directory';

export { DIRECTORY_MIME_TYPE };

/** Electron exposes the real filesystem path on File objects from native drag-drop. */
export function getElectronFilePath(file: globalThis.File): string | null {
  try {
    const fromWebUtils = window.electron?.getPathForFile?.(file);
    if (typeof fromWebUtils === 'string' && fromWebUtils.length > 0) {
      return fromWebUtils;
    }
  } catch {
    // Fall back to legacy Electron File.path when webUtils is unavailable.
  }
  const path = (file as globalThis.File & { path?: string }).path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

export function normalizePathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return window.electron?.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getWebkitRelativePath(file: globalThis.File): string | null {
  const rel = (file as globalThis.File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return rel ? rel : null;
}

/**
 * Windows Explorer often expands a folder drop into many files, each with
 * webkitRelativePath like "Project/src/index.ts". Recover the folder root path.
 */
export function inferExpandedFolderDropRoot(files: globalThis.File[]): string | null {
  if (files.length === 0) return null;

  const roots = files.map((file) => {
    const path = getElectronFilePath(file);
    const rel = getWebkitRelativePath(file);
    if (!path || !rel) return null;

    const parts = rel.split(/[\\/]/).filter(Boolean);
    if (parts.length < 2) return null;

    const folderName = parts[0]!;
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedRel = rel.replace(/\\/g, '/');
    if (!normalizedPath.endsWith(normalizedRel)) return null;

    return path.slice(0, path.length - rel.length) + folderName;
  }).filter((value): value is string => !!value);

  if (roots.length !== files.length) return null;

  const rootKey = normalizePathKey(roots[0]!);
  return roots.every((root) => normalizePathKey(root) === rootKey) ? roots[0]! : null;
}

function isDirectoryDragItem(item: DataTransferItem): boolean {
  const entry = item.webkitGetAsEntry?.();
  return entry?.isDirectory === true;
}

function resolveDirectoryDropPath(item: DataTransferItem, allFiles: globalThis.File[]): string | null {
  const entry = item.webkitGetAsEntry?.();
  const file = item.getAsFile();
  const candidates = file
    ? [file]
    : entry?.name
      ? allFiles.filter((candidate) => candidate.name === entry.name)
      : [];

  for (const candidate of candidates) {
    const path = getElectronFilePath(candidate);
    if (path) return path;
  }
  return null;
}

export function collectDroppedFiles(dataTransfer: DataTransfer): {
  pathFiles: string[];
  bufferFiles: globalThis.File[];
} {
  const pathFiles: string[] = [];
  const bufferFiles: globalThis.File[] = [];
  const seenPaths = new Set<string>();
  const allFiles = Array.from(dataTransfer.files ?? []);

  const addPath = (path: string) => {
    const key = normalizePathKey(path);
    if (seenPaths.has(key)) return;
    seenPaths.add(key);
    pathFiles.push(path);
  };

  const expandedFolderRoot = inferExpandedFolderDropRoot(allFiles);
  if (expandedFolderRoot) {
    addPath(expandedFolderRoot);
    return { pathFiles, bufferFiles };
  }

  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;

      if (isDirectoryDragItem(item)) {
        const directoryPath = resolveDirectoryDropPath(item, allFiles);
        if (directoryPath) addPath(directoryPath);
        continue;
      }

      const file = item.getAsFile();
      if (!file) continue;

      const electronPath = getElectronFilePath(file);
      if (electronPath) {
        addPath(electronPath);
        continue;
      }
      bufferFiles.push(file);
    }
    return { pathFiles, bufferFiles };
  }

  for (const file of allFiles) {
    const electronPath = getElectronFilePath(file);
    if (electronPath) {
      addPath(electronPath);
    } else {
      bufferFiles.push(file);
    }
  }
  return { pathFiles, bufferFiles };
}

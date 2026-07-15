import { app, nativeImage } from 'electron';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import type {
  FilePreviewError,
  FilePreviewTreeNode,
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
  WorkspaceFileRef,
} from '@shared/host-api/contract';
import {
  FILE_PREVIEW_MAX_BINARY_BYTES,
  FILE_PREVIEW_MAX_TEXT_BYTES,
} from '@shared/file-preview/limits';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { expandPath, resolveOpenClawStateDir } from '../utils/paths';
import {
  resolveClawXStagingDir,
  type AttachmentAccess,
  type StagedAttachmentRegistry,
} from './attachment-access';
import { isRecord } from './payload-utils';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const DIRECTORY_MIME_TYPE = 'application/x-directory';
const FILE_PREVIEW_TREE_MAX_DEPTH = 6;
const FILE_PREVIEW_TREE_MAX_NODES = 5000;
const FILE_PREVIEW_DIR_BLACKLIST = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

type StagePathsPayload = {
  filePaths?: unknown;
};

type StageBufferPayload = {
  base64?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
};

type PathPayload = {
  path?: unknown;
  content?: unknown;
  opts?: unknown;
};

type ResolvedSandboxedPath = {
  realPath: string;
  readOnly: boolean;
};

type ResolvedWorkspaceTarget = {
  root: string;
  target: string;
};

type OpenWorkspaceTarget = ResolvedWorkspaceTarget & {
  handle: FileHandle;
  stat: Stats;
};

type WorkspaceFs = {
  open: (path: string, flags: number) => Promise<FileHandle>;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<Stats>;
};

type FilesApiDependencies = {
  workspaceFs?: WorkspaceFs;
  attachmentAccess?: AttachmentAccess;
  stagedAttachments?: StagedAttachmentRegistry;
  stagingHooks?: {
    beforeDestinationOpen?: (input: { stagingDir: string; destinationPath: string }) => Promise<void>;
  };
};

type PinnedStagingDirectory = {
  lexicalPath: string;
  canonicalPath: string;
  dev: number;
  ino: number;
};

type PinnedStagingArea = {
  stagingDir: string;
  directories: PinnedStagingDirectory[];
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function generateImageBufferPreview(buffer: Buffer, mimeType: string): string | null {
  try {
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function requirePath(payload: unknown): string {
  const path = isRecord(payload) ? payload.path : payload;
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Invalid file path');
  }
  return path;
}

export function isPathInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === 'win32' ? win32 : posix;
  const c = pathApi.resolve(child);
  const p = pathApi.resolve(parent);
  const childFromParent = pathApi.relative(p, c);
  return childFromParent === ''
    || (!childFromParent.startsWith(`..${pathApi.sep}`)
      && childFromParent !== '..'
      && !pathApi.isAbsolute(childFromParent));
}

function workspaceError(error: unknown): FilePreviewError {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'outsideSandbox' || message === 'notFound' || message === 'notDirectory') {
    return message;
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return 'notFound';
  if (code === 'ENOTDIR') return 'notDirectory';
  if (code === 'ELOOP') return 'outsideSandbox';
  return 'operationFailed';
}

function isSamePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function resolveWorkspaceTarget(
  ref: WorkspaceFileRef,
  fsP: WorkspaceFs,
): Promise<ResolvedWorkspaceTarget> {
  if (!ref || typeof ref.workspaceRoot !== 'string' || !ref.workspaceRoot.trim()
    || typeof ref.relativePath !== 'string' || !ref.relativePath.trim()) {
    throw new Error('outsideSandbox');
  }
  const relativePath = ref.relativePath;
  if (isAbsolute(relativePath) || posix.isAbsolute(relativePath) || win32.isAbsolute(relativePath)
    || relativePath.split(/[\\/]+/).includes('..')) {
    throw new Error('outsideSandbox');
  }

  let root: string;
  try {
    root = await fsP.realpath(expandPath(ref.workspaceRoot));
    if (!(await fsP.stat(root)).isDirectory()) throw new Error('outsideSandbox');
  } catch (error) {
    if (error instanceof Error && error.message === 'outsideSandbox') throw error;
    throw new Error('outsideSandbox', { cause: error });
  }

  const candidate = resolve(root, relativePath);
  if (!isPathInside(candidate, root)) throw new Error('outsideSandbox');

  try {
    const target = await fsP.realpath(candidate);
    if (!isPathInside(target, root)) throw new Error('outsideSandbox');
    return { root, target };
  } catch (error) {
    if (error instanceof Error && error.message === 'outsideSandbox') throw error;
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  let parent = dirname(candidate);
  while (true) {
    try {
      const existingParent = await fsP.realpath(parent);
      if (!isPathInside(existingParent, root)) throw new Error('outsideSandbox');
      throw new Error('notFound');
    } catch (error) {
      if (error instanceof Error && (error.message === 'outsideSandbox' || error.message === 'notFound')) {
        throw error;
      }
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const nextParent = dirname(parent);
      if (nextParent === parent) throw new Error('outsideSandbox', { cause: error });
      parent = nextParent;
    }
  }
}

async function revalidateWorkspaceTarget(
  resolvedTarget: ResolvedWorkspaceTarget,
  fsP: WorkspaceFs,
): Promise<string> {
  const root = await fsP.realpath(resolvedTarget.root);
  if (!isSamePath(root, resolvedTarget.root)) throw new Error('outsideSandbox');
  if (!(await fsP.stat(root)).isDirectory()) throw new Error('outsideSandbox');

  const target = await fsP.realpath(resolvedTarget.target);
  if (!isSamePath(target, resolvedTarget.target) || !isPathInside(target, root)) {
    throw new Error('outsideSandbox');
  }
  return target;
}

async function openWorkspaceTarget(ref: WorkspaceFileRef, fsP: WorkspaceFs): Promise<OpenWorkspaceTarget> {
  const resolvedTarget = await resolveWorkspaceTarget(ref, fsP);
  let handle: FileHandle | undefined;
  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    handle = await fsP.open(resolvedTarget.target, constants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    const target = await revalidateWorkspaceTarget(resolvedTarget, fsP);
    const pathStat = await fsP.stat(target);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new Error('outsideSandbox');
    }
    return { ...resolvedTarget, handle, stat };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    throw error;
  }
}

async function readOpenedFile(handle: FileHandle, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= maxBytes) {
    const length = Math.min(64 * 1024, maxBytes + 1 - total);
    const chunk = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(chunk, 0, length, total);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  return total > maxBytes ? null : Buffer.concat(chunks, total);
}

function getWorkspaceBinaryCap(value: unknown): number {
  const maxBytes = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return Math.max(1, Math.min(maxBytes ?? FILE_PREVIEW_MAX_BINARY_BYTES, FILE_PREVIEW_MAX_BINARY_BYTES));
}

function getFilePreviewWriteRoots(): string[] {
  const roots: string[] = [];
  roots.push(resolve(join(homedir(), '.openclaw')));
  try {
    roots.push(resolve(app.getPath('userData')));
  } catch {
    // ignore
  }
  roots.push(resolve(resolveClawXStagingDir()));
  return roots;
}

async function resolveSandboxedPath(
  input: string,
  mode: 'read' | 'write' = 'read',
): Promise<ResolvedSandboxedPath> {
  if (!input.trim()) {
    throw new Error('outsideSandbox');
  }
  const expanded = expandPath(input);
  const fsP = await import('node:fs/promises');
  let real: string;
  try {
    real = await fsP.realpath(expanded);
  } catch {
    real = resolve(expanded);
  }
  const writeRoots = getFilePreviewWriteRoots();
  if (writeRoots.some((root) => isPathInside(real, root))) {
    return { realPath: real, readOnly: false };
  }
  if (mode === 'write') {
    throw new Error('readOnlyRoot');
  }
  return { realPath: real, readOnly: true };
}

function looksLikeBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function shouldSkipDirEntry(name: string, includeHidden: boolean): boolean {
  if (FILE_PREVIEW_DIR_BLACKLIST.has(name)) return true;
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function shouldSkipFileEntry(name: string, includeHidden: boolean): boolean {
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function getTreeOptions(opts: unknown): FilePreviewTreeOptions {
  return isRecord(opts) ? opts as FilePreviewTreeOptions : {};
}

function getBinaryOptions(opts: unknown): FileReadBinaryOptions {
  return isRecord(opts) ? opts as FileReadBinaryOptions : {};
}

export function createFilesApi(dependencies: FilesApiDependencies = {}): CompleteHostServiceRegistry['files'] {
  const getWorkspaceFs = async (): Promise<WorkspaceFs> => dependencies.workspaceFs
    ?? await import('node:fs/promises');
  const stagingAreaName = `clawx-${process.pid}-${crypto.randomUUID()}`;
  let stagingAreaPromise: Promise<PinnedStagingArea> | null = null;

  const initializeStagingArea = async (): Promise<PinnedStagingArea> => {
    const fsP = await import('node:fs/promises');
    const directories: PinnedStagingDirectory[] = [];
    const ensureDirectory = async (lexicalPath: string, parent?: PinnedStagingDirectory) => {
      let entryStat: Stats;
      try {
        entryStat = await fsP.lstat(lexicalPath);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code !== 'ENOENT') throw error;
        await fsP.mkdir(lexicalPath, { mode: 0o700 });
        entryStat = await fsP.lstat(lexicalPath);
      }
      if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) {
        throw new Error('Invalid ClawX staging directory');
      }
      const canonicalPath = await fsP.realpath(lexicalPath);
      const canonicalStat = await fsP.stat(canonicalPath);
      if (!canonicalStat.isDirectory()
        || (parent && !isPathInside(canonicalPath, parent.canonicalPath))) {
        throw new Error('Invalid ClawX staging directory');
      }
      const pinned = {
        lexicalPath,
        canonicalPath,
        dev: canonicalStat.dev,
        ino: canonicalStat.ino,
      };
      directories.push(pinned);
      return pinned;
    };

    const stateDir = await ensureDirectory(resolveOpenClawStateDir());
    const mediaDir = await ensureDirectory(join(stateDir.canonicalPath, 'media'), stateDir);
    const outboundDir = await ensureDirectory(join(mediaDir.canonicalPath, 'outbound'), mediaDir);
    const stagingRoot = await ensureDirectory(join(outboundDir.canonicalPath, 'clawx-staging'), outboundDir);
    const stagingArea = await ensureDirectory(join(stagingRoot.canonicalPath, stagingAreaName), stagingRoot);
    return { stagingDir: stagingArea.canonicalPath, directories };
  };

  const getStagingArea = () => {
    stagingAreaPromise ??= initializeStagingArea();
    return stagingAreaPromise;
  };

  const verifyStagingArea = async (area: PinnedStagingArea) => {
    const fsP = await import('node:fs/promises');
    for (const directory of area.directories) {
      const entryStat = await fsP.lstat(directory.lexicalPath);
      if (entryStat.isSymbolicLink()) throw new Error('Invalid ClawX staging directory');
      const currentPath = await fsP.realpath(directory.lexicalPath);
      const currentStat = await fsP.stat(currentPath);
      if (!currentStat.isDirectory()
        || !isSamePath(currentPath, directory.canonicalPath)
        || currentStat.dev !== directory.dev
        || currentStat.ino !== directory.ino) {
        throw new Error('Invalid ClawX staging directory');
      }
    }
  };

  const cleanupOwnedDestination = async (destinationPath: string, identity?: { dev: number; ino: number }) => {
    if (!identity) return;
    const fsP = await import('node:fs/promises');
    try {
      const current = await fsP.stat(destinationPath);
      if (current.dev === identity.dev && current.ino === identity.ino) {
        await fsP.unlink(destinationPath);
      }
    } catch {
      // The destination was already removed or redirected again.
    }
  };

  const createStagedFile = async (
    fileName: string,
    write: (handle: FileHandle) => Promise<void>,
  ): Promise<{ path: string; stat: Stats }> => {
    const fsP = await import('node:fs/promises');
    const area = await getStagingArea();
    await verifyStagingArea(area);
    const destinationPath = join(area.stagingDir, fileName);
    await dependencies.stagingHooks?.beforeDestinationOpen?.({
      stagingDir: area.stagingDir,
      destinationPath,
    });

    let handle: FileHandle | undefined;
    let identity: { dev: number; ino: number } | undefined;
    try {
      const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
      handle = await fsP.open(
        destinationPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      const openedStat = await handle.stat();
      identity = { dev: openedStat.dev, ino: openedStat.ino };

      // Node has no openat. Validate the unpredictable empty destination before writing bytes.
      await verifyStagingArea(area);
      const canonicalDestination = await fsP.realpath(destinationPath);
      const pathStat = await fsP.stat(canonicalDestination);
      if (!isPathInside(canonicalDestination, area.stagingDir)
        || pathStat.dev !== openedStat.dev
        || pathStat.ino !== openedStat.ino) {
        throw new Error('Invalid ClawX staging destination');
      }

      await write(handle);
      const finalStat = await handle.stat();
      await verifyStagingArea(area);
      const finalPath = await fsP.realpath(destinationPath);
      const finalPathStat = await fsP.stat(finalPath);
      if (!isSamePath(finalPath, canonicalDestination)
        || finalPathStat.dev !== finalStat.dev
        || finalPathStat.ino !== finalStat.ino) {
        throw new Error('Invalid ClawX staging destination');
      }
      await handle.close();
      handle = undefined;
      await verifyStagingArea(area);
      const registrationPath = await fsP.realpath(destinationPath);
      const registrationStat = await fsP.stat(registrationPath);
      if (!isSamePath(registrationPath, finalPath)
        || registrationStat.dev !== finalStat.dev
        || registrationStat.ino !== finalStat.ino) {
        throw new Error('Invalid ClawX staging destination');
      }
      return { path: registrationPath, stat: finalStat };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await cleanupOwnedDestination(destinationPath, identity);
      throw error;
    }
  };

  const copyIntoHandle = async (sourcePath: string, destination: FileHandle) => {
    const fsP = await import('node:fs/promises');
    const source = await fsP.open(sourcePath, constants.O_RDONLY);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (true) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        await destination.write(buffer, 0, bytesRead, position);
        position += bytesRead;
      }
    } finally {
      await source.close();
    }
  };
  return {
    stagePaths: async (payload) => {
      const body = isRecord(payload) ? payload as StagePathsPayload : {};
      const filePaths = Array.isArray(body.filePaths)
        ? body.filePaths.filter((value): value is string => typeof value === 'string')
        : [];
      const fsP = await import('node:fs/promises');
      const results = [];
      for (const filePath of filePaths) {
        const id = crypto.randomUUID();
        const fileName = basename(filePath);
        const sourceStat = await fsP.stat(filePath);
        if (sourceStat.isDirectory()) {
          results.push({
            id,
            fileName,
            mimeType: DIRECTORY_MIME_TYPE,
            fileSize: 0,
            stagedPath: filePath,
            preview: null,
          });
          continue;
        }

        const ext = extname(filePath);
        const mimeType = getMimeType(ext);
        const preview = mimeType.startsWith('image/')
          ? await generateImagePreview(filePath, mimeType)
          : null;
        const staged = await createStagedFile(`${id}${ext}`, (handle) => copyIntoHandle(filePath, handle));
        dependencies.stagedAttachments?.register(id, staged.path, filePath);
        results.push({ id, fileName, mimeType, fileSize: staged.stat.size, stagedPath: staged.path, preview });
      }
      return results;
    },
    stageBuffer: async (payload) => {
      const body = isRecord(payload) ? payload as StageBufferPayload : {};
      if (typeof body.base64 !== 'string' || typeof body.fileName !== 'string') {
        throw new Error('Invalid staged buffer payload');
      }
      const id = crypto.randomUUID();
      const payloadMimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
      const ext = extname(body.fileName) || mimeToExt(payloadMimeType);
      const buffer = Buffer.from(body.base64, 'base64');

      const mimeType = payloadMimeType || getMimeType(ext);
      const preview = mimeType.startsWith('image/')
        ? generateImageBufferPreview(buffer, mimeType)
        : null;
      const staged = await createStagedFile(`${id}${ext}`, async (handle) => {
        await handle.writeFile(buffer);
      });
      dependencies.stagedAttachments?.register(id, staged.path);
      return {
        id,
        fileName: body.fileName,
        mimeType,
        fileSize: buffer.length,
        stagedPath: staged.path,
        preview,
      };
    },
    resolveWorkspaceContext: async (input) => {
      if (!input || typeof input.workspaceRoot !== 'string' || !input.workspaceRoot.trim()
        || typeof input.executionCwd !== 'string' || !input.executionCwd.trim()) {
        return { ok: false, error: 'outsideSandbox' };
      }
      const fsP = await getWorkspaceFs();
      try {
        const [workspaceRoot, executionCwd] = await Promise.all([
          fsP.realpath(expandPath(input.workspaceRoot)),
          fsP.realpath(expandPath(input.executionCwd)),
        ]);
        const [rootStat, cwdStat] = await Promise.all([
          fsP.stat(workspaceRoot),
          fsP.stat(executionCwd),
        ]);
        if (!rootStat.isDirectory() || !cwdStat.isDirectory()) {
          return { ok: false, error: 'notDirectory' };
        }
        if (!isPathInside(executionCwd, workspaceRoot)) {
          return { ok: false, error: 'outsideSandbox' };
        }
        return { ok: true, workspaceRoot, executionCwd };
      } catch (error) {
        return { ok: false, error: workspaceError(error) };
      }
    },
    readWorkspaceText: async (ref) => {
      let opened: OpenWorkspaceTarget | undefined;
      try {
        opened = await openWorkspaceTarget(ref, await getWorkspaceFs());
        const { stat, target } = opened;
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        if (stat.size > FILE_PREVIEW_MAX_TEXT_BYTES) {
          return { ok: false, error: 'tooLarge', size: stat.size };
        }
        const buf = await readOpenedFile(opened.handle, FILE_PREVIEW_MAX_TEXT_BYTES);
        if (!buf) return { ok: false, error: 'tooLarge', size: FILE_PREVIEW_MAX_TEXT_BYTES + 1 };
        if (looksLikeBinary(buf)) return { ok: false, error: 'binary', size: buf.length };
        return {
          ok: true,
          content: buf.toString('utf8'),
          mimeType: getMimeType(extname(target)),
          size: buf.length,
          readOnly: true,
        };
      } catch (error) {
        return { ok: false, error: workspaceError(error) };
      } finally {
        await opened?.handle.close().catch(() => undefined);
      }
    },
    readWorkspaceBinary: async (input) => {
      let opened: OpenWorkspaceTarget | undefined;
      try {
        opened = await openWorkspaceTarget(input, await getWorkspaceFs());
        const { stat, target } = opened;
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        const cap = getWorkspaceBinaryCap(input.maxBytes);
        if (stat.size > cap) return { ok: false, error: 'tooLarge', size: stat.size };
        const buf = await readOpenedFile(opened.handle, cap);
        if (!buf) return { ok: false, error: 'tooLarge', size: cap + 1 };
        return {
          ok: true,
          data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
          mimeType: getMimeType(extname(target)),
          size: buf.length,
          readOnly: true,
        };
      } catch (error) {
        return { ok: false, error: workspaceError(error) };
      } finally {
        await opened?.handle.close().catch(() => undefined);
      }
    },
    statWorkspaceFile: async (ref) => {
      let opened: OpenWorkspaceTarget | undefined;
      try {
        opened = await openWorkspaceTarget(ref, await getWorkspaceFs());
        const { stat } = opened;
        return {
          ok: true,
          size: stat.size,
          mtime: stat.mtimeMs,
          isFile: stat.isFile(),
          isDir: stat.isDirectory(),
          readOnly: true,
        };
      } catch (error) {
        return { ok: false, error: workspaceError(error) };
      } finally {
        await opened?.handle.close().catch(() => undefined);
      }
    },
    resolveAttachment: async (payload) => dependencies.attachmentAccess?.resolveAttachment(payload) ?? {
      ok: false,
      displayName: 'attachment',
      error: 'operationFailed',
    },
    readAttachmentText: async (ref) => dependencies.attachmentAccess?.readAttachmentText(ref) ?? {
      ok: false,
      error: 'operationFailed',
    },
    readAttachmentBinary: async (payload) => dependencies.attachmentAccess?.readAttachmentBinary(payload) ?? {
      ok: false,
      error: 'operationFailed',
    },
    openAttachment: async (ref) => dependencies.attachmentAccess?.openAttachment(ref) ?? {
      ok: false,
      error: 'operationFailed',
    },
    readText: async (payload) => {
      try {
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        if (stat.size > FILE_PREVIEW_MAX_TEXT_BYTES) return { ok: false, error: 'tooLarge', size: stat.size };
        const buf = await fsP.readFile(real);
        if (looksLikeBinary(buf)) return { ok: false, error: 'binary', size: stat.size };
        return {
          ok: true,
          content: buf.toString('utf8'),
          mimeType: getMimeType(extname(real)),
          size: stat.size,
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    readBinary: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        const opts = getBinaryOptions(body.opts);
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : undefined;
        const cap = Math.max(1, Math.min(maxBytes ?? FILE_PREVIEW_MAX_BINARY_BYTES, FILE_PREVIEW_MAX_BINARY_BYTES));
        if (stat.size > cap) return { ok: false, error: 'tooLarge', size: stat.size };
        const buf = await fsP.readFile(real);
        const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return {
          ok: true,
          data: view,
          mimeType: getMimeType(extname(real)),
          size: stat.size,
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    writeText: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        if (typeof body.content !== 'string') return { ok: false, error: 'invalidContent' };
        if (Buffer.byteLength(body.content, 'utf8') > FILE_PREVIEW_MAX_TEXT_BYTES) {
          return { ok: false, error: 'tooLarge' };
        }
        const { realPath: real } = await resolveSandboxedPath(requirePath(payload), 'write');
        const fsP = await import('node:fs/promises');
        let stat;
        try {
          stat = await fsP.stat(real);
        } catch {
          return { ok: false, error: 'notFound' };
        }
        if (!stat.isFile()) return { ok: false, error: 'notFound' };
        await fsP.writeFile(real, body.content, 'utf8');
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message === 'readOnlyRoot') return { ok: false, error: 'readOnlyRoot' };
        return { ok: false, error: message };
      }
    },
    stat: async (payload) => {
      try {
        const { realPath: real, readOnly } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        return {
          ok: true,
          size: stat.size,
          mtime: stat.mtimeMs,
          isFile: stat.isFile(),
          isDir: stat.isDirectory(),
          readOnly,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    listDir: async (payload) => {
      try {
        const { realPath: real } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const dirents = await fsP.readdir(real, { withFileTypes: true });
        const entries = await Promise.all(dirents.map(async (entry) => {
          const abs = join(real, entry.name);
          let size = 0;
          try {
            if (entry.isFile()) size = (await fsP.stat(abs)).size;
          } catch {
            // non-fatal
          }
          return {
            name: entry.name,
            path: abs,
            isDir: entry.isDirectory(),
            size,
          };
        }));
        return { ok: true, entries };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
    listTree: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as PathPayload : {};
        const opts = getTreeOptions(body.opts);
        const { realPath: real } = await resolveSandboxedPath(requirePath(payload), 'read');
        const fsP = await import('node:fs/promises');
        const stat = await fsP.stat(real);
        if (!stat.isDirectory()) return { ok: false, error: 'notDirectory' };
        const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? FILE_PREVIEW_TREE_MAX_DEPTH, 12));
        const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? FILE_PREVIEW_TREE_MAX_NODES, 50000));
        const includeHidden = !!opts.includeHidden;

        let nodeCount = 0;
        let truncated = false;

        const walk = async (absDir: string, depth: number): Promise<FilePreviewTreeNode[] | undefined> => {
          if (depth > maxDepth || truncated) return undefined;
          let dirents;
          try {
            dirents = await fsP.readdir(absDir, { withFileTypes: true });
          } catch {
            return [];
          }
          const children: FilePreviewTreeNode[] = [];
          for (const entry of dirents) {
            if (truncated) break;
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();
            if (!isDir && !isFile) continue;
            if (isDir && shouldSkipDirEntry(entry.name, includeHidden)) continue;
            if (isFile && shouldSkipFileEntry(entry.name, includeHidden)) continue;
            if (nodeCount >= maxNodes) {
              truncated = true;
              break;
            }
            nodeCount += 1;
            const abs = join(absDir, entry.name);
            const node: FilePreviewTreeNode = {
              name: entry.name,
              relPath: relative(real, abs).split(sep).join('/'),
              absPath: abs,
              isDir,
            };
            if (isFile) {
              try {
                const fstat = await fsP.stat(abs);
                node.size = fstat.size;
                node.mtime = fstat.mtimeMs;
              } catch {
                // non-fatal
              }
            } else {
              try {
                node.mtime = (await fsP.stat(abs)).mtimeMs;
              } catch {
                // non-fatal
              }
              node.children = await walk(abs, depth + 1) ?? [];
            }
            children.push(node);
          }
          children.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return children;
        };

        const root: FilePreviewTreeNode = {
          name: basename(real) || real,
          relPath: '',
          absPath: real,
          isDir: true,
          mtime: stat.mtimeMs,
          children: (await walk(real, 1)) ?? [],
        };
        return { ok: true, root, truncated };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'outsideSandbox') return { ok: false, error: 'outsideSandbox' };
        if (message.includes('ENOENT')) return { ok: false, error: 'notFound' };
        return { ok: false, error: message };
      }
    },
  };
}

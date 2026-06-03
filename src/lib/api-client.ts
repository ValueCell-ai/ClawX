import { AppError, normalizeAppError } from './error-model';
import { hostApi } from './host-api';
export { AppError } from './error-model';

export function toUserMessage(error: unknown): string {
  const appError = error instanceof AppError ? error : normalizeAppError(error);

  switch (appError.code) {
    case 'AUTH_INVALID':
      return 'Authentication failed. Check API key or login session and retry.';
    case 'TIMEOUT':
      return 'Request timed out. Please retry.';
    case 'RATE_LIMIT':
      return 'Too many requests. Please wait and try again.';
    case 'PERMISSION':
      return 'Permission denied. Check your configuration and retry.';
    case 'CHANNEL_UNAVAILABLE':
      return 'Service channel unavailable. Retry after restarting the app or gateway.';
    case 'NETWORK':
      return 'Network error. Please verify connectivity and retry.';
    case 'CONFIG':
      return 'Configuration is invalid. Please review settings.';
    case 'GATEWAY':
      return 'Gateway is unavailable. Start or restart the gateway and retry.';
    default:
      return appError.message || 'Unexpected error occurred.';
  }
}

// ── File preview wrappers ─────────────────────────────────────────────
//
// Thin typed wrappers over the sandboxed hostApi.files routes exposed by
// the main process. Callers get file-preview shapes and exhaustive error codes.

export type FilePreviewError =
  | 'outsideSandbox'
  | 'readOnlyRoot'
  | 'tooLarge'
  | 'binary'
  | 'notFound'
  | 'notDirectory'
  | 'invalidContent'
  | string;

export interface ReadTextFileResult {
  ok: boolean;
  content?: string;
  mimeType?: string;
  size?: number;
  /**
   * Set by the main process when the resolved path lives in a read-only
   * root (bundled skill, app resources, …).  The renderer should disable
   * editing affordances when this is true even if the caller passes
   * `readOnly={false}`.
   */
  readOnly?: boolean;
  error?: FilePreviewError;
}

export interface ReadBinaryFileResult {
  ok: boolean;
  data?: Uint8Array;
  mimeType?: string;
  size?: number;
  readOnly?: boolean;
  error?: FilePreviewError;
}

export interface ReadBinaryFileOptions {
  /** Optional override for the per-call ceiling (capped by the main-process limit). */
  maxBytes?: number;
}

export interface WriteTextFileResult {
  ok: boolean;
  error?: FilePreviewError;
}

export interface StatFileResult {
  ok: boolean;
  size?: number;
  mtime?: number;
  isFile?: boolean;
  isDir?: boolean;
  readOnly?: boolean;
  error?: FilePreviewError;
}

export interface ListDirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface ListDirResult {
  ok: boolean;
  entries?: ListDirEntry[];
  error?: FilePreviewError;
}

export interface TreeNode {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: TreeNode[];
}

export interface ListTreeOptions {
  maxDepth?: number;
  maxNodes?: number;
  includeHidden?: boolean;
}

export interface ListTreeResult {
  ok: boolean;
  root?: TreeNode;
  truncated?: boolean;
  error?: FilePreviewError;
}

export const readTextFile = (path: string): Promise<ReadTextFileResult> =>
  hostApi.files.readText(path) as unknown as Promise<ReadTextFileResult>;

export const readBinaryFile = (
  path: string,
  opts?: ReadBinaryFileOptions,
): Promise<ReadBinaryFileResult> =>
  hostApi.files.readBinary(path, opts) as unknown as Promise<ReadBinaryFileResult>;

export const writeTextFile = (path: string, content: string): Promise<WriteTextFileResult> =>
  hostApi.files.writeText(path, content) as unknown as Promise<WriteTextFileResult>;

export const statFile = (path: string): Promise<StatFileResult> =>
  hostApi.files.stat(path) as unknown as Promise<StatFileResult>;

export const listDir = (path: string): Promise<ListDirResult> =>
  hostApi.files.listDir(path) as unknown as Promise<ListDirResult>;

export const listTree = (path: string, opts?: ListTreeOptions): Promise<ListTreeResult> =>
  hostApi.files.listTree(path, opts) as unknown as Promise<ListTreeResult>;

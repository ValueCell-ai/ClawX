import { trackUiEvent } from './telemetry';
import {
  AppError,
  type AppErrorCode,
  mapBackendErrorCode,
  normalizeAppError,
} from './error-model';
export { AppError } from './error-model';

type TransportKind = 'ipc';

type UnifiedRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

type UnifiedResponse = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const UNIFIED_CHANNELS = new Set<string>([
  'app:version',
  'app:name',
  'app:platform',
  'settings:getAll',
  'settings:get',
  'settings:set',
  'settings:setMany',
  'settings:reset',
  'provider:list',
  'provider:get',
  'provider:getDefault',
  'provider:hasApiKey',
  'provider:getApiKey',
  'provider:validateKey',
  'provider:save',
  'provider:delete',
  'provider:setApiKey',
  'provider:updateWithKey',
  'provider:deleteApiKey',
  'provider:setDefault',
  'update:status',
  'update:version',
  'update:check',
  'update:download',
  'update:install',
  'update:setChannel',
  'update:setAutoDownload',
  'update:cancelAutoInstall',
  'usage:recentTokenHistory',
]);

const SLOW_REQUEST_THRESHOLD_MS = 800;

function mapUnifiedErrorCode(code?: string): AppErrorCode {
  return mapBackendErrorCode(code);
}

function shouldLogApiRequests(): boolean {
  try {
    return import.meta.env.DEV || window.localStorage.getItem('clawx:api-log') === '1';
  } catch {
    return !!import.meta.env.DEV;
  }
}

function logApiAttempt(entry: {
  requestId: string;
  channel: string;
  transport: TransportKind;
  attempt: number;
  durationMs: number;
  ok: boolean;
  error?: unknown;
}): void {
  if (!shouldLogApiRequests()) return;
  const base = `[api-client] id=${entry.requestId} channel=${entry.channel} transport=${entry.transport} attempt=${entry.attempt} durationMs=${entry.durationMs}`;
  if (entry.ok) {
    console.info(`${base} result=ok`);
  } else {
    console.warn(`${base} result=error`, entry.error);
  }
}

function toUnifiedRequest(channel: string, args: unknown[]): UnifiedRequest {
  const splitIndex = channel.indexOf(':');
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    module: channel.slice(0, splitIndex),
    action: channel.slice(splitIndex + 1),
    payload: args.length <= 1 ? args[0] : args,
  };
}

async function invokeViaIpc<T>(channel: string, args: unknown[]): Promise<T> {
  if (channel !== 'app:request' && UNIFIED_CHANNELS.has(channel)) {
    const request = toUnifiedRequest(channel, args);

    try {
      const response = await window.electron.ipcRenderer.invoke('app:request', request) as UnifiedResponse;
      if (!response?.ok) {
        const message = response?.error?.message || 'Unified IPC request failed';
        if (message.includes('APP_REQUEST_UNSUPPORTED:')) {
          throw new Error(message);
        }
        throw new AppError(mapUnifiedErrorCode(response?.error?.code), message, response?.error);
      }
      return response.data as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('APP_REQUEST_UNSUPPORTED:') || message.includes('Invalid IPC channel: app:request')) {
        // Fallback to legacy channel handlers.
      } else {
        throw normalizeAppError(err, { transport: 'ipc', channel, source: 'app:request' });
      }
    }
  }

  try {
    return await window.electron.ipcRenderer.invoke(channel, ...args) as T;
  } catch (err) {
    throw normalizeAppError(err, { transport: 'ipc', channel, source: 'legacy-ipc' });
  }
}

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

export async function invokeApi<T>(channel: string, ...args: unknown[]): Promise<T> {
  const requestId = crypto.randomUUID();
  const transport: TransportKind = 'ipc';
  const attempt = 1;
  const startedAt = Date.now();
  try {
    const value = await invokeViaIpc<T>(channel, args);
    const durationMs = Date.now() - startedAt;
    logApiAttempt({
      requestId,
      channel,
      transport,
      attempt,
      durationMs,
      ok: true,
    });
    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      trackUiEvent('api.request', {
        requestId,
        channel,
        transport,
        attempt,
        durationMs,
        fallbackUsed: false,
      });
    }
    return value;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logApiAttempt({
      requestId,
      channel,
      transport,
      attempt,
      durationMs,
      ok: false,
      error: err,
    });
    trackUiEvent('api.request_error', {
      requestId,
      channel,
      transport,
      attempt,
      durationMs,
      message: err instanceof Error ? err.message : String(err),
    });
    throw normalizeAppError(err, {
      requestId,
      channel,
      transport,
      attempt,
      durationMs,
    });
  }
}

export async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  return invokeApi<T>(channel, ...args);
}

export async function invokeIpcWithRetry<T>(
  channel: string,
  args: unknown[] = [],
  retries = 1,
  retryable: AppErrorCode[] = ['TIMEOUT', 'NETWORK'],
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i <= retries; i += 1) {
    try {
      return await invokeApi<T>(channel, ...args);
    } catch (err) {
      lastError = err;
      if (!(err instanceof AppError) || !retryable.includes(err.code) || i === retries) {
        throw err;
      }
    }
  }

  throw normalizeAppError(lastError);
}

// ── File preview wrappers ─────────────────────────────────────────────
//
// Thin typed wrappers over the sandboxed file:* IPC channels exposed by
// the main process. Callers stay free of `invokeIpc('file:readText', ...)`
// boilerplate and get exhaustive error codes.

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
  invokeIpc<ReadTextFileResult>('file:readText', path);

export const readBinaryFile = (
  path: string,
  opts?: ReadBinaryFileOptions,
): Promise<ReadBinaryFileResult> =>
  invokeIpc<ReadBinaryFileResult>('file:readBinary', path, opts);

export const writeTextFile = (path: string, content: string): Promise<WriteTextFileResult> =>
  invokeIpc<WriteTextFileResult>('file:writeText', path, content);

export const statFile = (path: string): Promise<StatFileResult> =>
  invokeIpc<StatFileResult>('file:stat', path);

export const listDir = (path: string): Promise<ListDirResult> =>
  invokeIpc<ListDirResult>('file:listDir', path);

export const listTree = (path: string, opts?: ListTreeOptions): Promise<ListTreeResult> =>
  invokeIpc<ListTreeResult>('file:listTree', path, opts);

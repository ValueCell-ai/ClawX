import { app, type NativeImage } from 'electron';
import {
  execFile as nodeExecFile,
  spawn as nodeSpawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const PROCESS_TIMEOUT_MS = 5_000;
export const PROCESS_MAX_BUFFER_BYTES = 1_048_576;
export const HANDLER_NAME_MAX_LENGTH = 256;
export const HANDLER_ID_MAX_LENGTH = 512;
export const NATIVE_PATH_MAX_LENGTH = 4_096;
export const ICON_DATA_URL_MAX_BYTES = 65_536;
export const CACHE_TTL_MS = 300_000;
export const CACHE_MAX_ENTRIES = 128;

export type OpenWithPlatform = 'darwin' | 'win32' | 'linux';

export type SystemOpenHandler = {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault: boolean;
};

export type AttachmentOpenWithService = {
  platform: OpenWithPlatform;
  list(filePath: string): Promise<SystemOpenHandler[]>;
  open(
    filePath: string,
    handlerId: string,
    revalidateFile: () => Promise<string>,
  ): Promise<void>;
};

type ExecFileDependency = (
  file: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => ChildProcess;

type SpawnDependency = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

type IconImage = Pick<NativeImage, 'isEmpty' | 'toPNG'>;

export type AttachmentOpenWithDependencies = {
  platform?: OpenWithPlatform;
  clock?: () => number;
  execFile?: ExecFileDependency;
  spawn?: SpawnDependency;
  loadIcon?: (filePath: string) => Promise<IconImage>;
  resolveHelperPath?: () => string;
};

type NativeOpenHandler = SystemOpenHandler & {
  nativeId: string;
  applicationPath?: string;
  iconSourcePath?: string;
};

type CacheEntry = {
  createdAt: number;
  handlers: NativeOpenHandler[];
};

const cacheSizeReaders = new WeakMap<AttachmentOpenWithService, () => number>();

/** @internal Test-only retention check; never exposes cache keys or values. */
export function getAttachmentOpenWithCacheSizeForTest(service: AttachmentOpenWithService): number {
  return cacheSizeReaders.get(service)?.() ?? 0;
}

const WINDOWS_PUBLIC_ID = /^[a-f0-9]{64}$/;
const POWERSHELL_PREFIX_ARGS = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
];

const MACOS_JXA_PROGRAM = String.raw`
ObjC.import('Foundation');
ObjC.import('AppKit');

function stringValue(value) {
  if (!value) return '';
  try { return ObjC.unwrap(value); } catch (_) { return String(value); }
}

function iconPngBase64(workspace, bundlePath) {
  try {
    var image = workspace.iconForFile(bundlePath);
    var targetSize = $.NSMakeSize(32, 32);
    var resized = $.NSImage.alloc.initWithSize(targetSize);
    resized.lockFocus;
    image.drawInRectFromRectOperationFraction(
      $.NSMakeRect(0, 0, 32, 32),
      $.NSZeroRect,
      $.NSCompositingOperationCopy,
      1.0
    );
    resized.unlockFocus;
    var bitmap = $.NSBitmapImageRep.imageRepWithData(resized.TIFFRepresentation);
    if (!bitmap) return '';
    var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
    if (!png || Number(png.length) === 0) return '';
    return stringValue(png.base64EncodedStringWithOptions(0));
  } catch (_) {
    return '';
  }
}

function run(argv) {
  if (!argv || (argv.length !== 1 && argv.length !== 2)) return JSON.stringify([]);
  var includeIcons = argv.length === 2 && argv[1] === 'icons';
  if (argv.length === 2 && !includeIcons) return JSON.stringify([]);
  var fileURL = $.NSURL.fileURLWithPath(argv[0]);
  var workspace = $.NSWorkspace.sharedWorkspace;
  var applicationURLs = workspace.URLsForApplicationsToOpenURL(fileURL);
  var defaultURL = workspace.URLForApplicationToOpenURL(fileURL);
  var records = [];

  for (var index = 0; index < Number(applicationURLs.count); index += 1) {
    var applicationURL = applicationURLs.objectAtIndex(index);
    var bundle = $.NSBundle.bundleWithURL(applicationURL);
    var bundleId = stringValue(bundle.bundleIdentifier);
    var bundlePath = stringValue(applicationURL.path);
    var name = stringValue($.NSFileManager.defaultManager.displayNameAtPath(bundlePath));
    if (!bundleId || !name || !bundlePath) continue;
    var record = {
      nativeId: bundleId,
      name: name,
      applicationPath: bundlePath,
      isDefault: Boolean(defaultURL && applicationURL.isEqual(defaultURL))
    };
    if (includeIcons) {
      var icon = iconPngBase64(workspace, bundlePath);
      if (icon) record.iconPngBase64 = icon;
    }
    records.push(record);
  }

  return JSON.stringify(records);
}
`;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
  }
  return false;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !hasControlCharacters(value);
}

function isOptionalBoundedPath(value: unknown): value is string | undefined {
  return value === undefined || isBoundedString(value, NATIVE_PATH_MAX_LENGTH);
}

function iconDataUrlFromBase64(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return undefined;
  }
  const iconDataUrl = `data:image/png;base64,${value}`;
  if (Buffer.byteLength(iconDataUrl, 'utf8') > ICON_DATA_URL_MAX_BYTES) return undefined;
  const png = Buffer.from(value, 'base64');
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < pngSignature.length || !png.subarray(0, pngSignature.length).equals(pngSignature)) {
    return undefined;
  }
  return iconDataUrl;
}

function associationKey(platform: OpenWithPlatform, filePath: string): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const basename = pathApi.basename(filePath).toLocaleLowerCase('en-US');
  const extension = pathApi.extname(basename);
  return extension || basename;
}

function processEnvironment(platform: OpenWithPlatform): NodeJS.ProcessEnv {
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    const env: NodeJS.ProcessEnv = {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      PATH: [
        path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
        path.win32.join(systemRoot, 'System32'),
        systemRoot,
      ].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    };
    for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return env;
  }

  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const key of ['HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL'] as const) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function publicHandlers(handlers: NativeOpenHandler[]): SystemOpenHandler[] {
  return handlers.map(({ id, name, iconDataUrl, isDefault }) => ({
    id,
    name,
    ...(iconDataUrl ? { iconDataUrl } : {}),
    isDefault,
  }));
}

function windowsPublicId(nativeId: string): string {
  return createHash('sha256').update(`win32\0${nativeId}`, 'utf8').digest('hex');
}

function normalizeRecords(platform: OpenWithPlatform, output: string): NativeOpenHandler[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const deduplicated = new Map<string, NativeOpenHandler>();
  for (const value of parsed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (!isBoundedString(record.nativeId, HANDLER_ID_MAX_LENGTH)) continue;
    if (!isBoundedString(record.name, HANDLER_NAME_MAX_LENGTH)) continue;
    if (typeof record.isDefault !== 'boolean') continue;
    if (!isOptionalBoundedPath(record.applicationPath)) continue;
    if (!isOptionalBoundedPath(record.iconSourcePath)) continue;
    if (platform === 'darwin' && !isBoundedString(record.applicationPath, NATIVE_PATH_MAX_LENGTH)) {
      continue;
    }

    const id = platform === 'win32' ? windowsPublicId(record.nativeId) : record.nativeId;
    const iconDataUrl = platform === 'darwin'
      ? iconDataUrlFromBase64(record.iconPngBase64)
      : undefined;
    const existing = deduplicated.get(id);
    if (existing) {
      if (record.isDefault) existing.isDefault = true;
      if (!existing.iconDataUrl && iconDataUrl) existing.iconDataUrl = iconDataUrl;
      continue;
    }
    deduplicated.set(id, {
      id,
      nativeId: record.nativeId,
      name: record.name,
      ...(record.applicationPath ? { applicationPath: record.applicationPath } : {}),
      ...(record.iconSourcePath ? { iconSourcePath: record.iconSourcePath } : {}),
      ...(iconDataUrl ? { iconDataUrl } : {}),
      isDefault: record.isDefault,
    });
  }

  const handlers = [...deduplicated.values()];
  return [
    ...handlers.filter((handler) => handler.isDefault),
    ...handlers.filter((handler) => !handler.isDefault),
  ];
}

function defaultHelperPath(): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, 'resources', 'scripts', 'attachment-open-with.ps1');
}

function processError(reason: string): Error {
  return new Error(`attachment-open-with:${reason}`);
}

export function createAttachmentOpenWithService(
  dependencies: AttachmentOpenWithDependencies = {},
): AttachmentOpenWithService {
  const platform = dependencies.platform ?? (
    process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
  );
  const clock = dependencies.clock ?? Date.now;
  const execFile = dependencies.execFile ?? (nodeExecFile as ExecFileDependency);
  const spawn = dependencies.spawn ?? (nodeSpawn as SpawnDependency);
  const loadIcon = dependencies.loadIcon ?? ((filePath: string) => app.getFileIcon(filePath, { size: 'normal' }));
  const resolveHelperPath = dependencies.resolveHelperPath ?? defaultHelperPath;
  const cache = new Map<string, CacheEntry>();

  function runExec(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        timeout: PROCESS_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER_BYTES,
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        env: processEnvironment(platform),
      }, (error, stdout) => {
        if (error) {
          reject(processError('process-failed'));
          return;
        }
        resolve(stdout);
      });
    });
  }

  async function discover(filePath: string, includeIcons = false): Promise<NativeOpenHandler[]> {
    try {
      if (platform === 'darwin') {
        const output = await runExec('/usr/bin/osascript', [
          '-l',
          'JavaScript',
          '-e',
          MACOS_JXA_PROGRAM,
          '--',
          filePath,
          ...(includeIcons ? ['icons'] : []),
        ]);
        return normalizeRecords(platform, output);
      }
      if (platform === 'win32') {
        const output = await runExec('powershell.exe', [
          ...POWERSHELL_PREFIX_ARGS,
          resolveHelperPath(),
          'list',
          filePath,
        ]);
        return normalizeRecords(platform, output);
      }
      return [];
    } catch {
      return [];
    }
  }

  async function enrichIcons(handlers: NativeOpenHandler[]): Promise<NativeOpenHandler[]> {
    if (platform === 'darwin') return handlers;
    return await Promise.all(handlers.map(async (handler) => {
      const iconPath = handler.iconSourcePath ?? handler.applicationPath;
      if (!iconPath) return handler;
      try {
        const image = await loadIcon(iconPath);
        if (image.isEmpty()) return handler;
        const png = image.toPNG();
        if (png.length === 0) return handler;
        const iconDataUrl = `data:image/png;base64,${png.toString('base64')}`;
        if (Buffer.byteLength(iconDataUrl, 'utf8') > ICON_DATA_URL_MAX_BYTES) return handler;
        return { ...handler, iconDataUrl };
      } catch {
        return handler;
      }
    }));
  }

  async function list(filePath: string): Promise<SystemOpenHandler[]> {
    const now = clock();
    for (const [key, entry] of cache) {
      if (now - entry.createdAt >= CACHE_TTL_MS) cache.delete(key);
    }
    if (platform === 'linux') return [];
    if (!isBoundedString(filePath, NATIVE_PATH_MAX_LENGTH)) return [];
    const cacheKey = `${platform}:${associationKey(platform, filePath)}`;
    const cached = cache.get(cacheKey);
    if (cached && now - cached.createdAt < CACHE_TTL_MS) {
      return publicHandlers(cached.handlers);
    }

    const handlers = await enrichIcons(await discover(filePath, true));
    cache.set(cacheKey, { createdAt: now, handlers });
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    return publicHandlers(handlers);
  }

  async function openMac(
    filePath: string,
    handlerId: string,
    revalidateFile: () => Promise<string>,
  ): Promise<void> {
    const handlers = await discover(filePath);
    const selected = handlers.find((handler) => handler.id === handlerId && handler.applicationPath);
    if (!selected?.applicationPath) throw processError('unknown-handler');
    const revalidatedPath = await revalidateFile();
    if (!isBoundedString(revalidatedPath, NATIVE_PATH_MAX_LENGTH)) throw processError('invalid-path');
    if (associationKey(platform, revalidatedPath) !== associationKey(platform, filePath)) {
      throw processError('association-changed');
    }
    try {
      await runExec('/usr/bin/open', ['-a', selected.applicationPath, revalidatedPath]);
    } catch {
      throw processError('invoke-failed');
    }
  }

  function openWindows(
    filePath: string,
    handlerId: string,
    revalidateFile: () => Promise<string>,
  ): Promise<void> {
    if (!WINDOWS_PUBLIC_ID.test(handlerId)) return Promise.reject(processError('unknown-handler'));

    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn('powershell.exe', [
          ...POWERSHELL_PREFIX_ARGS,
          resolveHelperPath(),
          'prepare-open',
          filePath,
          handlerId,
        ], {
          windowsHide: true,
          shell: false,
          stdio: 'pipe',
          env: processEnvironment(platform),
        });
      } catch {
        reject(processError('helper-start-failed'));
        return;
      }

      let settled = false;
      let ready = false;
      let invokeSent = false;
      let outputBytes = 0;
      let stdoutBuffer = '';

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      const abort = (error: Error) => {
        if (settled) return;
        try {
          child.kill();
        } catch {
          // The bounded rejection is sufficient if the process already exited.
        }
        finish(error);
      };

      const handleReady = async () => {
        try {
          const revalidatedPath = await revalidateFile();
          if (settled) return;
          if (!isBoundedString(revalidatedPath, NATIVE_PATH_MAX_LENGTH)) {
            abort(processError('invalid-path'));
            return;
          }
          if (associationKey(platform, revalidatedPath) !== associationKey(platform, filePath)) {
            abort(processError('association-changed'));
            return;
          }
          invokeSent = true;
          child.stdin.end(`${JSON.stringify({ command: 'invoke', path: revalidatedPath })}\n`, 'utf8');
        } catch (error) {
          abort(error instanceof Error ? error : processError('revalidation-failed'));
        }
      };

      const timeout = setTimeout(() => abort(processError('helper-timeout')), PROCESS_TIMEOUT_MS);

      const accountOutput = (chunk: Buffer | string): boolean => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > PROCESS_MAX_BUFFER_BYTES) {
          abort(processError('helper-output-limit'));
          return false;
        }
        return true;
      };

      child.stdout.on('data', (chunk: Buffer | string) => {
        if (settled || !accountOutput(chunk)) return;
        if (ready) {
          abort(processError('helper-protocol'));
          return;
        }
        stdoutBuffer += chunk.toString();
        const newline = stdoutBuffer.indexOf('\n');
        if (newline < 0) return;
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
        const remainder = stdoutBuffer.slice(newline + 1);
        let message: unknown;
        try {
          message = JSON.parse(line) as unknown;
        } catch {
          abort(processError('helper-protocol'));
          return;
        }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          abort(processError('helper-protocol'));
          return;
        }
        const record = message as Record<string, unknown>;
        if (record.ready !== true || Object.keys(record).length !== 1 || remainder.trim()) {
          abort(processError('helper-protocol'));
          return;
        }
        ready = true;
        stdoutBuffer = '';
        void handleReady();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        if (!settled) accountOutput(chunk);
      });
      child.stdin.on('error', () => abort(processError('helper-stdin')));
      child.on('error', () => abort(processError('helper-start-failed')));
      child.on('close', (code) => {
        if (settled) return;
        if (code === 0 && invokeSent) {
          finish();
          return;
        }
        finish(processError(ready ? 'helper-failed' : 'unknown-handler'));
      });
    });
  }

  async function open(
    filePath: string,
    handlerId: string,
    revalidateFile: () => Promise<string>,
  ): Promise<void> {
    if (!isBoundedString(filePath, NATIVE_PATH_MAX_LENGTH)) throw processError('invalid-path');
    if (!isBoundedString(handlerId, HANDLER_ID_MAX_LENGTH)) throw processError('unknown-handler');
    if (platform === 'linux') throw processError('unsupported-platform');
    if (platform === 'darwin') return await openMac(filePath, handlerId, revalidateFile);
    return await openWindows(filePath, handlerId, revalidateFile);
  }

  const service = { platform, list, open };
  cacheSizeReaders.set(service, () => cache.size);
  return service;
}

// @vitest-environment node

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '/workspace/clawx',
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getAppPath: () => electronState.appPath,
    getFileIcon: vi.fn(),
  },
}));

import {
  HANDLER_ID_MAX_LENGTH,
  HANDLER_NAME_MAX_LENGTH,
  NATIVE_PATH_MAX_LENGTH,
  PROCESS_MAX_BUFFER_BYTES,
  PROCESS_TIMEOUT_MS,
  createAttachmentOpenWithService,
  type AttachmentOpenWithDependencies,
} from '@electron/services/attachment-open-with';

const temporaryDirectories: string[] = [];

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

type WindowsNativeHandlerRecord = {
  nativeId: string;
  name: string;
  applicationPath?: string;
  iconSourcePath?: string;
  isDefault: boolean;
};

function isOptionalNativePath(value: unknown): value is string | undefined {
  return value === undefined || (
    typeof value === 'string'
    && value.length > 0
    && value.length <= NATIVE_PATH_MAX_LENGTH
    && !hasControlCharacters(value)
  );
}

function isWindowsNativeHandlerRecord(value: unknown): value is WindowsNativeHandlerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.nativeId === 'string'
    && record.nativeId.length > 0
    && record.nativeId.length <= HANDLER_ID_MAX_LENGTH
    && !hasControlCharacters(record.nativeId)
    && typeof record.name === 'string'
    && record.name.length > 0
    && record.name.length <= HANDLER_NAME_MAX_LENGTH
    && !hasControlCharacters(record.name)
    && typeof record.isDefault === 'boolean'
    && isOptionalNativePath(record.applicationPath)
    && isOptionalNativePath(record.iconSourcePath);
}

async function temporaryTextFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'clawx-open-with-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'native smoke.txt');
  await writeFile(filePath, 'attachment open-with native smoke\n', 'utf8');
  return filePath;
}

function sourceHelperPath(): string {
  return join(import.meta.dirname, '..', '..', 'resources', 'scripts', 'attachment-open-with.ps1');
}

function windowsHelperArgs(...args: string[]): string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    sourceHelperPath(),
    ...args,
  ];
}

async function runWindowsHelper(...args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = nodeSpawn('powershell.exe', windowsHelperArgs(...args), {
      windowsHide: true,
      shell: false,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('native Windows helper timeout'));
    }, PROCESS_TIMEOUT_MS);
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve({ code, stdout, stderr });
    };
    const collect = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > PROCESS_MAX_BUFFER_BYTES) {
        child.kill();
        finish(new Error('native Windows helper output exceeded bound'));
        return;
      }
      if (stream === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.on('error', (error) => finish(error));
    child.on('close', (code) => finish(undefined, code));
  });
}

afterEach(async () => {
  electronState.isPackaged = false;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('attachment open-with native bridges', () => {
  it.runIf(process.platform === 'darwin')('executes the real macOS JXA application enumeration', async () => {
    const filePath = await temporaryTextFile();
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    const handlers = await service.list(filePath);

    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.some((handler) => handler.isDefault)).toBe(true);
    const nativeIcons = handlers.flatMap((handler) => handler.iconDataUrl ? [handler.iconDataUrl] : []);
    expect(nativeIcons.length).toBeGreaterThan(0);
    if (nativeIcons.length > 1) {
      expect(new Set(nativeIcons).size).toBeGreaterThan(1);
    }
    for (const handler of handlers) {
      expect(handler.id.length).toBeGreaterThan(0);
      expect(handler.id.length).toBeLessThanOrEqual(HANDLER_ID_MAX_LENGTH);
      expect(handler.name.length).toBeGreaterThan(0);
      expect(handler.name.length).toBeLessThanOrEqual(HANDLER_NAME_MAX_LENGTH);
      expect(hasControlCharacters(handler.id)).toBe(false);
      expect(hasControlCharacters(handler.name)).toBe(false);
    }
  });

  it.runIf(process.platform === 'win32')('retains a real Windows COM handler through ready and exits cleanly on cancel', async () => {
    const filePath = await realpath(await temporaryTextFile());
    const listResult = await runWindowsHelper('list', filePath);
    expect(listResult.code, listResult.stderr).toBe(0);
    const parsed = JSON.parse(listResult.stdout) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    const records = parsed as unknown[];
    expect(records.length).toBeGreaterThan(0);
    const validRecords = records.filter(isWindowsNativeHandlerRecord);
    expect(validRecords).toHaveLength(records.length);
    const defaultHandlers = validRecords.filter((record) => record.isDefault);
    expect(defaultHandlers).toHaveLength(1);
    const defaultHandler = defaultHandlers[0];
    expect(defaultHandler).toBeDefined();
    if (!defaultHandler) throw new Error('Windows .txt association has no valid default handler');
    expect(validRecords).toContain(defaultHandler);
    const nativeId = defaultHandler.nativeId;
    const publicId = createHash('sha256').update(`win32\0${nativeId}`, 'utf8').digest('hex');

    const matchedResult = await new Promise<{ code: number | null; lines: string[] }>((resolve, reject) => {
      const child = nodeSpawn('powershell.exe', windowsHelperArgs(
        'prepare-open',
        filePath,
        publicId,
      ), {
        windowsHide: true,
        shell: false,
        stdio: 'pipe',
      });
      let settled = false;
      let outputBytes = 0;
      let stdoutBuffer = '';
      let cancelSent = false;
      const lines: string[] = [];
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error('native matched prepare-open timeout'));
      }, PROCESS_TIMEOUT_MS);
      const finish = (error?: Error, code: number | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve({ code, lines });
      };
      const account = (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > PROCESS_MAX_BUFFER_BYTES) {
          child.kill();
          finish(new Error('native matched prepare-open output exceeded bound'));
          return false;
        }
        return true;
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (!account(chunk)) return;
        stdoutBuffer += chunk.toString();
        let newline = stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          lines.push(line);
          const message = JSON.parse(line) as Record<string, unknown>;
          if (!cancelSent && message.ready === true && Object.keys(message).length === 1) {
            cancelSent = true;
            child.stdin.end(`${JSON.stringify({ command: 'cancel' })}\n`, 'utf8');
          }
          newline = stdoutBuffer.indexOf('\n');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        account(chunk);
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => {
        if (!cancelSent) {
          finish(new Error('matched helper exited before ready'));
          return;
        }
        finish(undefined, code);
      });
    });

    expect(matchedResult.lines).toEqual(['{"ready":true}']);
    expect(matchedResult.code).toBe(0);

    const nonmatchingResult = await runWindowsHelper('prepare-open', filePath, '0'.repeat(64));
    expect(nonmatchingResult.code).not.toBe(0);
    expect(nonmatchingResult.stdout).not.toContain('{"ready":true}');
  });

  it('resolves and executes the exact helper staged in a packaged resources tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-packaged-open-with-'));
    temporaryDirectories.push(root);
    const resourcesPath = join(root, 'resources');
    const stagedHelper = join(resourcesPath, 'resources', 'scripts', 'attachment-open-with.ps1');
    await mkdir(join(resourcesPath, 'resources', 'scripts'), { recursive: true });
    await copyFile(sourceHelperPath(), stagedHelper);
    const expectedSource = await readFile(sourceHelperPath(), 'utf8');
    const originalResourcesPath = process.resourcesPath;
    const execFile = vi.fn((...args: unknown[]) => {
      const helperPath = (args[1] as string[])[6];
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      void readFile(helperPath, 'utf8').then((content) => {
        expect(helperPath).toBe(stagedHelper);
        expect(content).toBe(expectedSource);
        callback(null, '[]', '');
      }, (error: unknown) => callback(error as Error, '', ''));
      return {};
    }) as unknown as NonNullable<AttachmentOpenWithDependencies['execFile']>;

    try {
      electronState.isPackaged = true;
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath });
      const service = createAttachmentOpenWithService({ platform: 'win32', execFile });

      await expect(service.list('C:\\Users\\Me\\packaged.txt')).resolves.toEqual([]);
      expect(execFile).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: originalResourcesPath,
      });
    }
  });

  it.runIf(process.platform !== 'win32')('keeps the Windows bridge smoke explicitly platform-gated', () => {
    expect(process.platform).not.toBe('win32');
  });

  it.runIf(process.platform !== 'darwin')('keeps the macOS bridge smoke explicitly platform-gated', () => {
    expect(process.platform).not.toBe('darwin');
  });
});

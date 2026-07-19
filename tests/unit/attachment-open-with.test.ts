// @vitest-environment node

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '/workspace/clawx',
  getFileIcon: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getAppPath: () => electronState.appPath,
    getFileIcon: electronState.getFileIcon,
  },
}));

import {
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  ICON_DATA_URL_MAX_BYTES,
  PROCESS_MAX_BUFFER_BYTES,
  PROCESS_TIMEOUT_MS,
  createAttachmentOpenWithService,
  getAttachmentOpenWithCacheSizeForTest,
  type AttachmentOpenWithDependencies,
} from '@electron/services/attachment-open-with';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function execResult(...stdoutValues: string[]): NonNullable<AttachmentOpenWithDependencies['execFile']> {
  let index = 0;
  return vi.fn((...args: unknown[]) => {
    const callback = args[3] as ExecCallback;
    callback(null, stdoutValues[Math.min(index, stdoutValues.length - 1)] ?? '', '');
    index += 1;
    return {};
  }) as unknown as NonNullable<AttachmentOpenWithDependencies['execFile']>;
}

function execFailure(error = new Error('sentinel private process failure')): NonNullable<AttachmentOpenWithDependencies['execFile']> {
  return vi.fn((...args: unknown[]) => {
    const callback = args[3] as ExecCallback;
    callback(error, '', 'sentinel private stderr');
    return {};
  }) as unknown as NonNullable<AttachmentOpenWithDependencies['execFile']>;
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly kill = vi.fn(() => true);
}

function spawnResult(child: FakeChildProcess): NonNullable<AttachmentOpenWithDependencies['spawn']> {
  return vi.fn(() => child) as unknown as NonNullable<AttachmentOpenWithDependencies['spawn']>;
}

function macRecord(overrides: Record<string, unknown> = {}) {
  return {
    nativeId: 'com.example.Editor',
    name: 'Example Editor',
    applicationPath: '/Applications/Example Editor.app',
    isDefault: false,
    ...overrides,
  };
}

function windowsRecord(overrides: Record<string, unknown> = {}) {
  return {
    nativeId: 'C:\\Windows\\System32\\notepad.exe',
    name: 'Notepad',
    applicationPath: 'C:\\Windows\\System32\\notepad.exe',
    iconSourcePath: 'C:\\Windows\\System32\\notepad.exe',
    isDefault: true,
    ...overrides,
  };
}

function json(records: unknown[]): string {
  return JSON.stringify(records);
}

describe('attachment open-with platform service', () => {
  beforeEach(() => {
    electronState.isPackaged = false;
    electronState.appPath = '/workspace/clawx';
    electronState.getFileIcon.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CLAWX_RENDERER_SENTINEL;
  });

  it('normalizes macOS Unicode records, rejects malformed siblings, deduplicates, and keeps OS order after the default', async () => {
    const output = json([
      macRecord({
        nativeId: 'com.example.First',
        name: 'Éditeur 一',
        applicationPath: '/Applications/First App 一.app',
      }),
      macRecord({
        nativeId: 'com.example.Second',
        name: 'Second',
        applicationPath: '/Applications/Second App.app',
      }),
      macRecord({
        nativeId: 'com.example.First',
        name: 'Duplicate',
        applicationPath: '/Applications/Duplicate.app',
        isDefault: true,
      }),
      macRecord({ nativeId: 'bad\nidentifier' }),
      macRecord({ name: 'bad\u0000name' }),
      macRecord({ applicationPath: `/Applications/${'p'.repeat(4_096)}.app` }),
      macRecord({ nativeId: 'i'.repeat(513) }),
      macRecord({ name: 'n'.repeat(257) }),
      null,
    ]);
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile: execResult(output),
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    await expect(service.list('/tmp/report with spaces.txt')).resolves.toEqual([
      { id: 'com.example.First', name: 'Éditeur 一', isDefault: true },
      { id: 'com.example.Second', name: 'Second', isDefault: false },
    ]);
  });

  it('normalizes desktop and packaged Windows handlers to deterministic opaque SHA-256 IDs', async () => {
    const desktopIdentity = 'C:\\Windows\\System32\\notepad.exe';
    const packagedIdentity = 'Microsoft.Reader_8wekyb3d8bbwe!App';
    const execFile = execResult(json([
      windowsRecord({ nativeId: desktopIdentity, isDefault: false }),
      windowsRecord({
        nativeId: packagedIdentity,
        name: 'Reader UWP',
        applicationPath: undefined,
        iconSourcePath: undefined,
        isDefault: true,
      }),
      windowsRecord({ nativeId: desktopIdentity, name: 'Duplicate desktop', isDefault: false }),
    ]));
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      execFile,
      resolveHelperPath: () => 'C:\\ClawX\\resources\\scripts\\attachment-open-with.ps1',
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    const handlers = await service.list('C:\\Users\\Me\\report.TXT');
    const packagedId = createHash('sha256').update(`win32\0${packagedIdentity}`).digest('hex');
    const desktopId = createHash('sha256').update(`win32\0${desktopIdentity}`).digest('hex');

    expect(handlers).toEqual([
      { id: packagedId, name: 'Reader UWP', isDefault: true },
      { id: desktopId, name: 'Notepad', isDefault: false },
    ]);
    expect(JSON.stringify(handlers)).not.toContain(packagedIdentity);
    expect(JSON.stringify(handlers)).not.toContain(desktopIdentity);
    expect(JSON.stringify(handlers)).not.toContain('System32');
  });

  it('caches lists by normalized association key for five minutes and refreshes at expiry', async () => {
    let now = 1_000;
    const execFile = execResult(
      json([macRecord({ name: 'First result' })]),
      json([macRecord({ name: 'Refreshed result' })]),
    );
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      clock: () => now,
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    expect((await service.list('/tmp/one.TXT'))[0]?.name).toBe('First result');
    now += CACHE_TTL_MS - 1;
    expect((await service.list('/tmp/two.txt'))[0]?.name).toBe('First result');
    expect(execFile).toHaveBeenCalledTimes(1);

    now += 1;
    expect((await service.list('/tmp/three.txt'))[0]?.name).toBe('Refreshed result');
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('prunes expired unrelated association entries on every list access', async () => {
    let now = 1_000;
    const execFile = execResult(json([macRecord()]));
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      clock: () => now,
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    await service.list('/tmp/first.alpha');
    expect(getAttachmentOpenWithCacheSizeForTest(service)).toBe(1);

    now += CACHE_TTL_MS;
    await expect(service.list('/tmp/invalid\npath')).resolves.toEqual([]);
    expect(execFile).toHaveBeenCalledOnce();
    expect(getAttachmentOpenWithCacheSizeForTest(service)).toBe(0);

    await service.list('/tmp/second.beta');

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(getAttachmentOpenWithCacheSizeForTest(service)).toBe(1);
  });

  it('bounds cache growth and evicts the oldest association entry', async () => {
    const execFile = execResult(json([macRecord()]));
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    for (let index = 0; index <= CACHE_MAX_ENTRIES; index += 1) {
      await service.list(`/tmp/item-${index}.extension-${index}`);
    }

    expect(getAttachmentOpenWithCacheSizeForTest(service)).toBe(CACHE_MAX_ENTRIES);
    expect(execFile).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1);

    await service.list('/tmp/item-0.extension-0');
    expect(execFile).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2);
  });

  it('uses the lower-case basename as the cache key when a file has no extension', async () => {
    const execFile = execResult(json([macRecord()]));
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    await service.list('/tmp/README');
    await service.list('/other/readme');
    await service.list('/other/NOTICE');

    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('accepts bounded macOS JXA PNG icons and omits malformed or oversized icon output', async () => {
    const iconPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const largestBoundedPng = Buffer.alloc(49_134);
    pngSignature.copy(largestBoundedPng);
    const oversizedPng = Buffer.alloc(49_135);
    pngSignature.copy(oversizedPng);
    expect(Buffer.byteLength(`data:image/png;base64,${largestBoundedPng.toString('base64')}`))
      .toBeLessThanOrEqual(ICON_DATA_URL_MAX_BYTES);
    expect(Buffer.byteLength(`data:image/png;base64,${oversizedPng.toString('base64')}`))
      .toBeGreaterThan(ICON_DATA_URL_MAX_BYTES);
    const loadIcon = vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('placeholder') }));
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile: execResult(json([
        macRecord({ nativeId: 'com.example.Valid', iconPngBase64 }),
        macRecord({ nativeId: 'com.example.LargestBounded', iconPngBase64: largestBoundedPng.toString('base64') }),
        macRecord({ nativeId: 'com.example.InvalidBase64', iconPngBase64: 'invalid?' }),
        macRecord({ nativeId: 'com.example.NotPng', iconPngBase64: Buffer.from('not png').toString('base64') }),
        macRecord({ nativeId: 'com.example.Large', iconPngBase64: oversizedPng.toString('base64') }),
      ])),
      loadIcon,
    });

    const handlers = await service.list('/tmp/icon.txt');

    expect(handlers).toEqual([
      {
        id: 'com.example.Valid',
        name: 'Example Editor',
        iconDataUrl: `data:image/png;base64,${iconPngBase64}`,
        isDefault: false,
      },
      {
        id: 'com.example.LargestBounded',
        name: 'Example Editor',
        iconDataUrl: `data:image/png;base64,${largestBoundedPng.toString('base64')}`,
        isDefault: false,
      },
      { id: 'com.example.InvalidBase64', name: 'Example Editor', isDefault: false },
      { id: 'com.example.NotPng', name: 'Example Editor', isDefault: false },
      { id: 'com.example.Large', name: 'Example Editor', isDefault: false },
    ]);
    expect(loadIcon).not.toHaveBeenCalled();
  });

  it('converts Windows icons independently and omits empty, oversized, and failed images', async () => {
    const records = json([
      windowsRecord({ nativeId: 'valid', iconSourcePath: 'C:\\Applications\\Valid.exe' }),
      windowsRecord({ nativeId: 'empty', iconSourcePath: 'C:\\Applications\\Empty.exe' }),
      windowsRecord({ nativeId: 'large', iconSourcePath: 'C:\\Applications\\Large.exe' }),
      windowsRecord({ nativeId: 'failed', iconSourcePath: 'C:\\Applications\\Failed.exe' }),
    ]);
    const loadIcon = vi.fn(async (iconPath: string) => {
      if (iconPath.includes('Failed')) throw new Error('private icon path failure');
      if (iconPath.includes('Empty')) {
        return { isEmpty: () => true, toPNG: () => Buffer.from('ignored') };
      }
      const png = iconPath.includes('Large') ? Buffer.alloc(ICON_DATA_URL_MAX_BYTES) : Buffer.from('png');
      return { isEmpty: () => false, toPNG: () => png };
    });
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      execFile: execResult(records),
      loadIcon,
    });

    const handlers = await service.list('/tmp/icon.txt');

    expect(handlers[0]?.iconDataUrl).toBe(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);
    expect(handlers.slice(1).every((handler) => handler.iconDataUrl === undefined)).toBe(true);
    expect(loadIcon).toHaveBeenCalledTimes(4);
  });

  it('uses bounded shell-free exec options and a fixed allowlisted Main environment', async () => {
    process.env.CLAWX_RENDERER_SENTINEL = 'must-not-cross';
    const execFile = execResult(json([macRecord()]));
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    await service.list('/tmp/safe.txt');

    const [command, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe('/usr/bin/osascript');
    expect(args.slice(0, 4)).toEqual(['-l', 'JavaScript', '-e', expect.any(String)]);
    expect(args.slice(-2)).toEqual(['/tmp/safe.txt', 'icons']);
    expect(options).toMatchObject({
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER_BYTES,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    expect(options.env).not.toHaveProperty('CLAWX_RENDERER_SENTINEL');
    expect(Object.keys(options.env as object)).toEqual(expect.arrayContaining(['PATH']));
    expect(Object.keys(options.env as object)).not.toEqual(expect.arrayContaining(['NODE_OPTIONS']));
  });

  it('silently degrades process failures and malformed whole-helper JSON to an empty list', async () => {
    const failed = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile: execFailure(),
    });
    const malformed = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile: execResult('{not-json'),
    });
    const wrongShape = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile: execResult('{"nativeId":"not-an-array"}'),
    });

    await expect(failed.list('/private/sentinel.txt')).resolves.toEqual([]);
    await expect(malformed.list('/private/sentinel.txt')).resolves.toEqual([]);
    await expect(wrongShape.list('/private/sentinel.txt')).resolves.toEqual([]);
  });

  it('does not execute discovery on Linux and rejects application-specific open', async () => {
    const execFile = execResult(json([macRecord()]));
    const spawn = vi.fn();
    const revalidateFile = vi.fn(async () => '/tmp/report.txt');
    const service = createAttachmentOpenWithService({
      platform: 'linux',
      execFile,
      spawn: spawn as unknown as NonNullable<AttachmentOpenWithDependencies['spawn']>,
    });

    await expect(service.list('/tmp/report.txt')).resolves.toEqual([]);
    await expect(service.open('/tmp/report.txt', 'handler', revalidateFile)).rejects.toThrow('unsupported');
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(revalidateFile).not.toHaveBeenCalled();
  });

  it('freshly enumerates macOS handlers for open and never invokes unknown IDs', async () => {
    const execFile = execResult(json([macRecord({ nativeId: 'com.example.Current' })]));
    const revalidateFile = vi.fn(async () => '/tmp/report.txt');
    const service = createAttachmentOpenWithService({ platform: 'darwin', execFile });

    await expect(service.open('/tmp/report.txt', 'com.example.Stale', revalidateFile)).rejects.toThrow('handler');

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(revalidateFile).not.toHaveBeenCalled();
    expect(vi.mocked(execFile).mock.calls.some((call) => call[0] === '/usr/bin/open')).toBe(false);
  });

  it('does not use the list cache for macOS open and invokes only the freshly matched bundle after revalidation', async () => {
    const events: string[] = [];
    let invocation = 0;
    const execFile = vi.fn((...args: unknown[]) => {
      const command = args[0] as string;
      const callback = args[3] as ExecCallback;
      invocation += 1;
      events.push(command === '/usr/bin/open' ? 'invoke' : `enumerate-${invocation}`);
      callback(null, command === '/usr/bin/open' ? '' : json([
        macRecord({
          nativeId: 'com.example.Editor',
          applicationPath: '/Applications/Fresh Editor.app',
        }),
      ]), '');
      return {};
    }) as unknown as NonNullable<AttachmentOpenWithDependencies['execFile']>;
    const revalidateFile = vi.fn(async () => {
      events.push('revalidate');
      return '/tmp/fresh report.TXT';
    });
    const service = createAttachmentOpenWithService({
      platform: 'darwin',
      execFile,
      loadIcon: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }),
    });

    await service.list('/tmp/report.txt');
    await service.open('/tmp/report.txt', 'com.example.Editor', revalidateFile);

    expect(events).toEqual(['enumerate-1', 'enumerate-2', 'revalidate', 'invoke']);
    expect(execFile).toHaveBeenCalledTimes(3);
    expect(vi.mocked(execFile).mock.calls[0]?.[1]?.slice(-2)).toEqual(['/tmp/report.txt', 'icons']);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]?.at(-1)).toBe('/tmp/report.txt');
    expect(vi.mocked(execFile).mock.calls[2]?.slice(0, 2)).toEqual([
      '/usr/bin/open',
      ['-a', '/Applications/Fresh Editor.app', '/tmp/fresh report.TXT'],
    ]);
  });

  it('prevents macOS invocation when ref revalidation fails or changes association', async () => {
    const records = json([macRecord({ nativeId: 'com.example.Editor' })]);
    const failedExec = execResult(records);
    const failed = createAttachmentOpenWithService({ platform: 'darwin', execFile: failedExec });
    await expect(failed.open('/tmp/report.txt', 'com.example.Editor', async () => {
      throw new Error('stale generation');
    })).rejects.toThrow('stale generation');
    expect(failedExec).toHaveBeenCalledTimes(1);

    const changedExec = execResult(records);
    const changed = createAttachmentOpenWithService({ platform: 'darwin', execFile: changedExec });
    await expect(changed.open(
      '/tmp/report.txt',
      'com.example.Editor',
      async () => '/tmp/report.pdf',
    )).rejects.toThrow('association');
    expect(changedExec).toHaveBeenCalledTimes(1);
  });

  it('passes Windows prepare-open separate Main path and opaque ID, then sends only the post-ready path', async () => {
    process.env.CLAWX_RENDERER_SENTINEL = 'must-not-cross';
    const child = new FakeChildProcess();
    const spawn = spawnResult(child);
    const opaqueId = createHash('sha256').update('win32\0native').digest('hex');
    const events: string[] = [];
    const stdin: string[] = [];
    child.stdin.on('data', (chunk) => {
      events.push('invoke-message');
      stdin.push(chunk.toString());
      queueMicrotask(() => child.emit('close', 0, null));
    });
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      spawn,
      resolveHelperPath: () => 'C:\\ClawX\\resources\\scripts\\attachment-open-with.ps1',
    });
    const revalidateFile = vi.fn(async () => {
      events.push('revalidate');
      return 'C:\\Users\\Me\\post-ready report.txt';
    });

    const openPromise = service.open('C:\\Users\\Me\\initial report.txt', opaqueId, revalidateFile);
    expect(revalidateFile).not.toHaveBeenCalled();
    child.stdout.write('{"ready":true}\n');
    await openPromise;

    expect(events).toEqual(['revalidate', 'invoke-message']);
    expect(stdin).toEqual([
      `${JSON.stringify({ command: 'invoke', path: 'C:\\Users\\Me\\post-ready report.txt' })}\n`,
    ]);
    const [command, args, options] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(command).toBe('powershell.exe');
    expect(args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\ClawX\\resources\\scripts\\attachment-open-with.ps1',
      'prepare-open',
      'C:\\Users\\Me\\initial report.txt',
      opaqueId,
    ]);
    expect(options).toMatchObject({ windowsHide: true, shell: false });
    expect(options.env).not.toHaveProperty('CLAWX_RENDERER_SENTINEL');
  });

  it('rejects a Windows handler that the fresh helper does not retain without revalidating or invoking', async () => {
    const child = new FakeChildProcess();
    const revalidateFile = vi.fn(async () => 'C:\\Users\\Me\\report.txt');
    const stdin = vi.fn();
    child.stdin.on('data', stdin);
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(child),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });

    const openPromise = service.open('C:\\Users\\Me\\report.txt', '0'.repeat(64), revalidateFile);
    child.emit('close', 12, null);

    await expect(openPromise).rejects.toThrow('handler');
    expect(revalidateFile).not.toHaveBeenCalled();
    expect(stdin).not.toHaveBeenCalled();
  });

  it('kills the retained Windows helper without invoking when post-ready revalidation fails', async () => {
    const child = new FakeChildProcess();
    const stdin = vi.fn();
    child.stdin.on('data', stdin);
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(child),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const openPromise = service.open('C:\\initial.txt', '1'.repeat(64), async () => {
      throw new Error('stale attachment generation');
    });

    child.stdout.write('{"ready":true}\n');

    await expect(openPromise).rejects.toThrow('stale attachment generation');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(stdin).not.toHaveBeenCalled();
  });

  it('kills the retained Windows helper without invoking when the association key changes', async () => {
    const child = new FakeChildProcess();
    const stdin = vi.fn();
    child.stdin.on('data', stdin);
    const service = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(child),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const openPromise = service.open(
      'C:\\initial.txt',
      '2'.repeat(64),
      async () => 'C:\\revalidated.pdf',
    );

    child.stdout.write('{"ready":true}\n');

    await expect(openPromise).rejects.toThrow('association');
    expect(child.kill).toHaveBeenCalledOnce();
    expect(stdin).not.toHaveBeenCalled();
  });

  it('bounds the Windows helper lifetime and aggregate output without invoking', async () => {
    vi.useFakeTimers();
    const timeoutChild = new FakeChildProcess();
    const timeoutService = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(timeoutChild),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const timeoutOpen = timeoutService.open('C:\\initial.txt', '3'.repeat(64), async () => 'C:\\final.txt');
    const timeoutExpectation = expect(timeoutOpen).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(PROCESS_TIMEOUT_MS + 1);
    await timeoutExpectation;
    expect(timeoutChild.kill).toHaveBeenCalledOnce();

    vi.useRealTimers();
    const outputChild = new FakeChildProcess();
    const outputService = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(outputChild),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const outputOpen = outputService.open('C:\\initial.txt', '4'.repeat(64), async () => 'C:\\final.txt');
    outputChild.stderr.write(Buffer.alloc(PROCESS_MAX_BUFFER_BYTES + 1));

    await expect(outputOpen).rejects.toThrow('output');
    expect(outputChild.kill).toHaveBeenCalledOnce();
  });

  it('rejects malformed or repeated ready records and an early stdin/process close without invoking', async () => {
    const malformedChild = new FakeChildProcess();
    const malformed = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(malformedChild),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const malformedOpen = malformed.open('C:\\initial.txt', '5'.repeat(64), async () => 'C:\\final.txt');
    malformedChild.stdout.write('{"ready":"yes"}\n');
    await expect(malformedOpen).rejects.toThrow('protocol');

    let finishRevalidation: ((path: string) => void) | undefined;
    const closeChild = new FakeChildProcess();
    const closeStdin = vi.fn();
    closeChild.stdin.on('data', closeStdin);
    const closed = createAttachmentOpenWithService({
      platform: 'win32',
      spawn: spawnResult(closeChild),
      resolveHelperPath: () => 'C:\\helper.ps1',
    });
    const closeOpen = closed.open('C:\\initial.txt', '6'.repeat(64), () => new Promise((resolve) => {
      finishRevalidation = resolve;
    }));
    closeChild.stdout.write('{"ready":true}\n');
    await vi.waitFor(() => expect(finishRevalidation).toBeTypeOf('function'));
    closeChild.emit('close', 13, null);
    finishRevalidation?.('C:\\final.txt');

    await expect(closeOpen).rejects.toThrow('helper');
    expect(closeStdin).not.toHaveBeenCalled();
  });

  it('resolves development and packaged helper paths without exposing them in public records', async () => {
    const devExec = execResult('[]');
    const dev = createAttachmentOpenWithService({ platform: 'win32', execFile: devExec });
    await dev.list('C:\\report.txt');
    expect((vi.mocked(devExec).mock.calls[0]?.[1] as string[])[6]).toBe(
      join('/workspace/clawx', 'resources', 'scripts', 'attachment-open-with.ps1'),
    );

    const originalResourcesPath = process.resourcesPath;
    try {
      electronState.isPackaged = true;
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: 'C:\\Program Files\\ClawX\\resources',
      });
      const packagedExec = execResult('[]');
      const packaged = createAttachmentOpenWithService({ platform: 'win32', execFile: packagedExec });
      await packaged.list('C:\\report.txt');
      expect((vi.mocked(packagedExec).mock.calls[0]?.[1] as string[])[6]).toBe(
        join('C:\\Program Files\\ClawX\\resources', 'resources', 'scripts', 'attachment-open-with.ps1'),
      );
    } finally {
      Object.defineProperty(process, 'resourcesPath', {
        configurable: true,
        value: originalResourcesPath,
      });
    }
  });

  it('keeps the helper under the global electron-builder resource rule and uses strict Shell COM executable matching', () => {
    const root = join(import.meta.dirname, '..', '..');
    const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
    const helper = readFileSync(join(root, 'resources', 'scripts', 'attachment-open-with.ps1'), 'utf8');

    expect(builder).toMatch(/from:\s*resources\//);
    expect(builder).toMatch(/to:\s*resources\//);
    expect(builder).toMatch(/-\s*["']\*\*\/\*["']/);
    expect(helper).toContain('SHAssocEnumHandlers');
    expect(helper).toContain('AssocQueryString');
    expect(helper).toContain('IAssocHandler');
    expect(helper).toContain('[Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)]');
    expect(helper).toContain('BindToHandler');
    expect(helper).toContain('HandlerBridge]::Prepare');
    expect(helper.match(/HandlerBridge\]::Prepare/g)).toHaveLength(1);
    expect(helper.match(/Enumerate\(association, publicHandlerId, true\)/g)).toHaveLength(1);
    expect(helper.split('{"ready":true}')).toHaveLength(2);
    expect(helper).toContain('[Console]::In.ReadLineAsync()');
    expect(helper).toContain('$readTask.Wait(5000)');
    expect(helper).toContain("$message.command -eq 'cancel'");
    expect(helper).toMatch(/\$message\.command -eq 'cancel'[\s\S]{0,200}\$exitCode = 0/);
    expect(helper).toContain('HandlerBridge]::HasSameAssociation');
    expect(helper.match(/HandlerBridge\]::Invoke/g)).toHaveLength(1);
    expect(helper).toContain('Path.GetFullPath');
    expect(helper).toContain('IsSameExecutable(defaultExecutable, nativeId)');
    expect(helper).toContain('string.Equals(defaultPath, handlerPath, StringComparison.OrdinalIgnoreCase)');
    expect(helper).not.toContain('Path.GetFileName(defaultExecutable)');
    expect(helper).not.toContain('IsSameExecutable(defaultExecutable, nativeId, applicationPath, iconPath)');
    expect(helper).not.toMatch(/Get-ItemProperty|reg\.exe|Start-Process|Registry/i);
  });

  it('runs the Windows native bridge test only in the Windows check job before build', () => {
    const root = join(import.meta.dirname, '..', '..');
    const workflow = readFileSync(join(root, '.github', 'workflows', 'check.yml'), 'utf8');
    const buildJobStart = workflow.indexOf('  build:');
    const checkJob = workflow.slice(0, buildJobStart);
    const buildJob = workflow.slice(buildJobStart);
    const installIndex = buildJob.indexOf('- name: Install dependencies');
    const bridgeIndex = buildJob.indexOf('- name: Test Windows attachment open-with bridge');
    const buildIndex = buildJob.indexOf('- name: Build');

    expect(checkJob).not.toContain('Test Windows attachment open-with bridge');
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(bridgeIndex).toBeGreaterThan(installIndex);
    expect(buildIndex).toBeGreaterThan(bridgeIndex);
  });
});

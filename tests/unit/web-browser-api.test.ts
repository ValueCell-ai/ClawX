import { EventEmitter } from 'node:events';
import type { Session, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBrowserGuestRegistry } from '@electron/main/web-browser-policy';
import { createWebBrowserApi } from '@electron/services/web-browser-api';

const { shellOpenExternalMock, shellOpenPathMock } = vi.hoisted(() => ({
  shellOpenExternalMock: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
  shellOpenPathMock: vi.fn<(path: string) => Promise<string>>().mockResolvedValue(''),
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: shellOpenExternalMock,
    openPath: shellOpenPathMock,
  },
}));

class MockGuest extends EventEmitter {
  destroyed = false;
  url = 'https://current.example/path';
  readonly loadURL = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function registerGuest(registry: WebBrowserGuestRegistry): MockGuest {
  const guest = new MockGuest();
  expect(registry.beginAttachment()).toBe(true);
  registry.completeAttachment(guest as unknown as WebContents);
  return guest;
}

describe('web browser host service', () => {
  let registry: WebBrowserGuestRegistry;
  let clearCache: ReturnType<typeof vi.fn>;
  let clearStorageData: ReturnType<typeof vi.fn>;
  let browserSession: Session;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new WebBrowserGuestRegistry();
    clearCache = vi.fn().mockResolvedValue(undefined);
    clearStorageData = vi.fn().mockResolvedValue(undefined);
    browserSession = { clearCache, clearStorageData } as unknown as Session;
  });

  it('normalizes absolute navigation and loads it in the registered guest', async () => {
    const guest = registerGuest(registry);
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.navigate({ url: 'HTTPS://Example.COM/path with space' })).resolves.toBeUndefined();

    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/path%20with%20space');
  });

  it('treats Electron ERR_ABORTED as a normal navigation cancellation', async () => {
    const guest = registerGuest(registry);
    const aborted = Object.assign(new Error("ERR_ABORTED (-3) loading 'https://example.com/'"), {
      code: 'ERR_ABORTED',
      errno: -3,
      url: 'https://example.com/',
    });
    guest.loadURL.mockRejectedValueOnce(aborted);
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.navigate({ url: 'https://example.com/' })).resolves.toBeUndefined();
  });

  it('preserves non-abort loadURL failures', async () => {
    const guest = registerGuest(registry);
    const failed = Object.assign(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://example.com/'"), {
      code: 'ERR_NAME_NOT_RESOLVED',
      errno: -105,
      url: 'https://example.com/',
    });
    guest.loadURL.mockRejectedValueOnce(failed);
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.navigate({ url: 'https://example.com/' })).rejects.toBe(failed);
  });

  it.each([
    '',
    'example.com',
    '/tmp/report.html',
    'about:blank',
    'about:srcdoc',
    'data:text/html,hello',
    'javascript:alert(1)',
    'mailto:test@example.com',
    'ftp://example.com/file',
    'file://server/share/file.txt',
    'file:/tmp/report.html',
  ])('rejects unsupported or reserved navigation target %j', async (url) => {
    const guest = registerGuest(registry);
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.navigate({ url })).rejects.toThrow();
    expect(guest.loadURL).not.toHaveBeenCalled();
  });

  it('rejects navigation without a live registered guest', async () => {
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.navigate({ url: 'https://example.com' })).rejects.toThrow();

    const guest = registerGuest(registry);
    guest.destroyed = true;
    await expect(api.navigate({ url: 'https://example.com' })).rejects.toThrow();
    expect(guest.loadURL).not.toHaveBeenCalled();
  });

  it('clears only cookies and waits for storage clearing', async () => {
    let resolveClear!: () => void;
    clearStorageData.mockReturnValue(new Promise<void>((resolve) => {
      resolveClear = resolve;
    }));
    const api = createWebBrowserApi({ browserSession, registry });
    let settled = false;

    const clearing = api.clearCookies().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(clearCache).not.toHaveBeenCalled();

    resolveClear();
    await clearing;
    expect(settled).toBe(true);
  });

  it.each([
    { first: 'cache' as const },
    { first: 'storage' as const },
  ])('clears site data without cookies and waits when $first resolves first', async ({ first }) => {
    let resolveCache!: () => void;
    let resolveStorage!: () => void;
    clearCache.mockReturnValue(new Promise<void>((resolve) => {
      resolveCache = resolve;
    }));
    clearStorageData.mockReturnValue(new Promise<void>((resolve) => {
      resolveStorage = resolve;
    }));
    const api = createWebBrowserApi({ browserSession, registry });
    let settled = false;

    const clearing = api.clearSiteData().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(clearStorageData).toHaveBeenCalledWith({
      storages: ['cachestorage', 'localstorage', 'indexdb', 'serviceworkers'],
    });
    expect(clearStorageData).not.toHaveBeenCalledWith(expect.objectContaining({ storages: ['cookies'] }));
    expect(settled).toBe(false);

    const resolveFirst = first === 'cache' ? resolveCache : resolveStorage;
    const resolveSecond = first === 'cache' ? resolveStorage : resolveCache;
    resolveFirst();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSecond();
    await clearing;
    expect(settled).toBe(true);
  });

  it('opens the Main-owned current guest URL instead of a caller URL', async () => {
    const guest = registerGuest(registry);
    guest.url = 'HTTPS://Example.COM/current path';
    const openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const api = createWebBrowserApi({ browserSession, registry, openExternal });

    await expect((api.openExternal as (payload?: unknown) => Promise<void>)({
      url: 'https://renderer.example/spoofed',
    })).resolves.toBeUndefined();

    expect(openExternal).toHaveBeenCalledWith('https://example.com/current%20path');
  });

  it('passes standard file URLs to shell.openExternal and never shell.openPath', async () => {
    const guest = registerGuest(registry);
    guest.url = 'file:///tmp/report%20one.html';
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.openExternal()).resolves.toBeUndefined();

    expect(shellOpenExternalMock).toHaveBeenCalledWith('file:///tmp/report%20one.html');
    expect(shellOpenPathMock).not.toHaveBeenCalled();
  });

  it('rejects external opening without a live guest or for about:blank', async () => {
    const api = createWebBrowserApi({ browserSession, registry });

    await expect(api.openExternal()).rejects.toThrow();

    const guest = registerGuest(registry);
    guest.url = 'about:blank';
    await expect(api.openExternal()).rejects.toThrow();

    guest.destroyed = true;
    await expect(api.openExternal()).rejects.toThrow();
    expect(shellOpenExternalMock).not.toHaveBeenCalled();
  });
});

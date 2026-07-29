import { EventEmitter } from 'node:events';
import type { Session, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBrowserGuestRegistry } from '@electron/main/web-browser-policy';
import { createWebBrowserApi } from '@electron/services/web-browser-api';

const shellOpenExternal = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>());

vi.mock('electron', () => ({
  shell: { openExternal: shellOpenExternal },
}));

class MockGuest extends EventEmitter {
  destroyed = false;
  url = 'file:///workspace/site.html';
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

describe('local HTML preview host service', () => {
  let registry: WebBrowserGuestRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    shellOpenExternal.mockResolvedValue(undefined);
    registry = new WebBrowserGuestRegistry();
  });

  function api() {
    return createWebBrowserApi({ browserSession: {} as Session, registry });
  }

  it('loads a normalized hostless local HTML URL in the registered guest', async () => {
    const guest = registerGuest(registry);

    await expect(api().navigate({ url: 'file:///workspace/site one.HTML' })).resolves.toBeUndefined();

    expect(guest.loadURL).toHaveBeenCalledWith('file:///workspace/site%20one.HTML');
  });

  it.each([
    '',
    'https://example.com/',
    'file:///workspace/readme.txt',
    'file://server/share/site.html',
    'file:///workspace/site.html?query=1',
    'file:///workspace/site.html#section',
    '/workspace/site.html',
    'javascript:alert(1)',
  ])('rejects non-local-HTML navigation %j', async (url) => {
    const guest = registerGuest(registry);

    await expect(api().navigate({ url })).rejects.toThrow('Only local HTML file URLs are allowed');
    expect(guest.loadURL).not.toHaveBeenCalled();
  });

  it('treats ERR_ABORTED as a normal load cancellation', async () => {
    const guest = registerGuest(registry);
    guest.loadURL.mockRejectedValueOnce(Object.assign(new Error('aborted'), {
      code: 'ERR_ABORTED',
      errno: -3,
    }));

    await expect(api().navigate({ url: 'file:///workspace/site.html' })).resolves.toBeUndefined();
  });

  it('preserves other load failures', async () => {
    const guest = registerGuest(registry);
    const failure = new Error('failed');
    guest.loadURL.mockRejectedValueOnce(failure);

    await expect(api().navigate({ url: 'file:///workspace/site.html' })).rejects.toBe(failure);
  });

  it('requires a live registered guest', async () => {
    await expect(api().navigate({ url: 'file:///workspace/site.html' }))
      .rejects.toThrow('Web browser guest is unavailable');
  });

  it('opens only an explicitly validated local HTML file externally', async () => {
    await expect(api().openExternal({ url: 'file:///workspace/site.html' })).resolves.toBeUndefined();
    expect(shellOpenExternal).toHaveBeenCalledWith('file:///workspace/site.html');

    await expect(api().openExternal({ url: 'https://example.com/' }))
      .rejects.toThrow('Only local HTML file URLs are allowed');
  });
});

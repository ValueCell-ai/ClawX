import { EventEmitter } from 'node:events';
import type { Session, WebContents, WebPreferences } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WebBrowserGuestRegistry,
  hardenWebBrowserPreferences,
  installWebBrowserGuestPolicy,
  isExpectedWebBrowserAttachment,
} from '@electron/main/web-browser-policy';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));

vi.mock('../../electron/utils/logger', () => ({
  logger: { warn: warnMock },
}));

type WindowOpenHandler = Parameters<WebContents['setWindowOpenHandler']>[0];

class MockWebContents extends EventEmitter {
  destroyed = false;
  windowOpenHandler: WindowOpenHandler | null = null;

  readonly loadURL = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly setUserAgent = vi.fn<(userAgent: string) => void>();
  readonly setWindowOpenHandler = vi.fn((handler: WindowOpenHandler) => {
    this.windowOpenHandler = handler;
  });

  constructor(
    readonly type: ReturnType<WebContents['getType']>,
    readonly session: Session,
  ) {
    super();
  }

  getType(): ReturnType<WebContents['getType']> {
    return this.type;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function asWebContents(contents: MockWebContents): WebContents {
  return contents as unknown as WebContents;
}

function attachmentParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    partition: WEB_BROWSER_PARTITION,
    src: WEB_BROWSER_INITIAL_URL,
    useragent: WEB_BROWSER_USER_AGENT,
    allowpopups: true,
    preload: '',
    ...overrides,
  };
}

function preventableEvent() {
  return { preventDefault: vi.fn() };
}

function attachGuest(
  embedder: MockWebContents,
  guest: MockWebContents,
  preferences: WebPreferences = {},
): void {
  const event = preventableEvent();
  embedder.emit('will-attach-webview', event, preferences, attachmentParams());
  expect(event.preventDefault).not.toHaveBeenCalled();
  embedder.emit('did-attach-webview', {}, asWebContents(guest));
}

describe('web browser attachment policy', () => {
  beforeEach(() => {
    warnMock.mockReset();
  });

  it('accepts only the exact attachment identity with a boolean popup flag', () => {
    expect(isExpectedWebBrowserAttachment(attachmentParams())).toBe(true);

    for (const overrides of [
      { partition: 'persist:other' },
      { src: 'https://example.com/' },
      { useragent: 'different' },
      { allowpopups: false },
      { allowpopups: 'true' },
      { allowpopups: 1 },
      { preload: '/tmp/preload.js' },
      { preload: undefined },
    ]) {
      expect(isExpectedWebBrowserAttachment(attachmentParams(overrides))).toBe(false);
    }
  });

  it('removes preload and forces every security-sensitive guest preference', () => {
    const preferences: WebPreferences = {
      preload: '/tmp/host-preload.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      plugins: true,
      allowRunningInsecureContent: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
    };

    hardenWebBrowserPreferences(preferences);

    expect(preferences).toEqual({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      plugins: false,
      allowRunningInsecureContent: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('reserves one pending slot and releases ownership only when its guest is destroyed', () => {
    const browserSession = {} as Session;
    const registry = new WebBrowserGuestRegistry();
    const guest = new MockWebContents('webview', browserSession);
    const unrelated = new MockWebContents('webview', browserSession);

    expect(registry.beginAttachment()).toBe(true);
    expect(registry.beginAttachment()).toBe(false);
    registry.cancelAttachment();
    expect(registry.beginAttachment()).toBe(true);

    registry.completeAttachment(asWebContents(guest));
    expect(registry.current()).toBe(guest);
    expect(registry.owns(asWebContents(guest))).toBe(true);
    expect(registry.owns(asWebContents(unrelated))).toBe(false);
    expect(registry.hasLiveGuest()).toBe(true);
    expect(registry.beginAttachment()).toBe(false);

    registry.cancelAttachment();
    unrelated.destroy();
    expect(registry.current()).toBe(guest);

    guest.destroy();
    expect(registry.current()).toBeNull();
    expect(registry.hasLiveGuest()).toBe(false);
    expect(registry.beginAttachment()).toBe(true);
  });

  it('hardens the reserved attachment synchronously and rejects a concurrent attachment', () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const registry = new WebBrowserGuestRegistry();
    installWebBrowserGuestPolicy(asWebContents(embedder), { browserSession, registry });

    const firstEvent = preventableEvent();
    const firstPreferences: WebPreferences = { preload: '/tmp/preload.js', nodeIntegration: true };
    embedder.emit('will-attach-webview', firstEvent, firstPreferences, attachmentParams());

    expect(firstEvent.preventDefault).not.toHaveBeenCalled();
    expect(firstPreferences.preload).toBeUndefined();
    expect(firstPreferences.nodeIntegration).toBe(false);

    const secondEvent = preventableEvent();
    embedder.emit('will-attach-webview', secondEvent, {}, attachmentParams());
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('registers only a webview from the dedicated session and cancels invalid reservations', () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const registry = new WebBrowserGuestRegistry();
    installWebBrowserGuestPolicy(asWebContents(embedder), { browserSession, registry });

    const wrongType = new MockWebContents('window', browserSession);
    embedder.emit('will-attach-webview', preventableEvent(), {}, attachmentParams());
    embedder.emit('did-attach-webview', {}, asWebContents(wrongType));
    expect(registry.current()).toBeNull();

    const wrongSession = new MockWebContents('webview', {} as Session);
    embedder.emit('will-attach-webview', preventableEvent(), {}, attachmentParams());
    embedder.emit('did-attach-webview', {}, asWebContents(wrongSession));
    expect(registry.current()).toBeNull();

    const guest = new MockWebContents('webview', browserSession);
    attachGuest(embedder, guest);
    expect(registry.current()).toBe(guest);

    embedder.emit('did-attach-webview', {}, asWebContents(guest));
    expect(guest.setUserAgent).toHaveBeenCalledOnce();
    expect(guest.listenerCount('will-navigate')).toBe(1);
    expect(guest.listenerCount('will-redirect')).toBe(1);
  });

  it('always denies popups and loads only allowed targets in the same guest', async () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const guest = new MockWebContents('webview', browserSession);
    const registry = new WebBrowserGuestRegistry();
    installWebBrowserGuestPolicy(asWebContents(embedder), { browserSession, registry });
    attachGuest(embedder, guest);

    expect(guest.setUserAgent).toHaveBeenCalledWith(WEB_BROWSER_USER_AGENT);
    expect(guest.windowOpenHandler).not.toBeNull();

    const allowed = guest.windowOpenHandler!({ url: ' HTTPS://EXAMPLE.COM/path ' } as never);
    expect(allowed).toEqual({ action: 'deny' });
    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/path');

    for (const url of ['about:blank', 'javascript:alert(1)', 'data:text/plain,hello']) {
      expect(guest.windowOpenHandler!({ url } as never)).toEqual({ action: 'deny' });
    }
    expect(guest.loadURL).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(3);

    guest.loadURL.mockRejectedValueOnce(new Error('load failed'));
    expect(guest.windowOpenHandler!({ url: 'https://failure.example/' } as never)).toEqual({ action: 'deny' });
    await vi.waitFor(() => expect(warnMock).toHaveBeenCalledTimes(4));
  });

  it('blocks disallowed page navigation and only main-frame redirects', () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const guest = new MockWebContents('webview', browserSession);
    installWebBrowserGuestPolicy(asWebContents(embedder), {
      browserSession,
      registry: new WebBrowserGuestRegistry(),
    });
    attachGuest(embedder, guest);

    for (const url of ['https://example.com/', 'http://localhost:3000/', 'file:///tmp/page.html']) {
      const event = Object.assign(preventableEvent(), { url, isMainFrame: true });
      guest.emit('will-navigate', event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }

    for (const url of ['about:blank', 'chrome://settings', 'file://server/page.html']) {
      const event = Object.assign(preventableEvent(), { url, isMainFrame: true });
      guest.emit('will-navigate', event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    const allowedRedirect = Object.assign(preventableEvent(), {
      url: 'https://redirect.example/',
      isMainFrame: true,
    });
    guest.emit('will-redirect', allowedRedirect);
    expect(allowedRedirect.preventDefault).not.toHaveBeenCalled();

    const blockedRedirect = Object.assign(preventableEvent(), {
      url: 'data:text/html,bad',
      isMainFrame: true,
    });
    guest.emit('will-redirect', blockedRedirect);
    expect(blockedRedirect.preventDefault).toHaveBeenCalledOnce();

    const subframeRedirect = Object.assign(preventableEvent(), {
      url: 'data:text/html,subframe',
      isMainFrame: false,
    });
    guest.emit('will-redirect', subframeRedirect);
    expect(subframeRedirect.preventDefault).not.toHaveBeenCalled();
  });

  it('removes installed listeners on guest destruction and installer cleanup', () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const firstGuest = new MockWebContents('webview', browserSession);
    const registry = new WebBrowserGuestRegistry();
    const cleanup = installWebBrowserGuestPolicy(asWebContents(embedder), {
      browserSession,
      registry,
    });
    attachGuest(embedder, firstGuest);

    expect(firstGuest.listenerCount('will-navigate')).toBe(1);
    expect(firstGuest.listenerCount('will-redirect')).toBe(1);
    firstGuest.destroy();
    expect(firstGuest.listenerCount('will-navigate')).toBe(0);
    expect(firstGuest.listenerCount('will-redirect')).toBe(0);
    expect(registry.current()).toBeNull();

    const replacementGuest = new MockWebContents('webview', browserSession);
    attachGuest(embedder, replacementGuest);
    cleanup();
    expect(embedder.listenerCount('will-attach-webview')).toBe(0);
    expect(embedder.listenerCount('did-attach-webview')).toBe(0);
    expect(replacementGuest.listenerCount('will-navigate')).toBe(0);
    expect(replacementGuest.listenerCount('will-redirect')).toBe(0);
    expect(registry.current()).toBe(replacementGuest);

    replacementGuest.destroy();
    expect(registry.current()).toBeNull();
  });
});

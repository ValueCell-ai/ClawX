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

const warn = vi.hoisted(() => vi.fn());

vi.mock('../../electron/utils/logger', () => ({
  logger: { warn },
}));

type WindowOpenHandler = Parameters<WebContents['setWindowOpenHandler']>[0];

class MockWebContents extends EventEmitter {
  destroyed = false;
  url = WEB_BROWSER_INITIAL_URL;
  windowOpenHandler: WindowOpenHandler | null = null;
  readonly loadURL = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  readonly insertCSS = vi.fn<(css: string, options?: { cssOrigin?: 'author' | 'user' }) => Promise<string>>()
    .mockResolvedValue('inert-links');
  readonly setUserAgent = vi.fn();
  readonly stop = vi.fn();
  readonly setWindowOpenHandler = vi.fn((handler: WindowOpenHandler) => {
    this.windowOpenHandler = handler;
  });

  constructor(
    private readonly type: ReturnType<WebContents['getType']>,
    readonly session: Session,
  ) {
    super();
  }

  getType() {
    return this.type;
  }

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    partition: WEB_BROWSER_PARTITION,
    src: WEB_BROWSER_INITIAL_URL,
    useragent: WEB_BROWSER_USER_AGENT,
    preload: '',
    ...overrides,
  };
}

function event() {
  return { preventDefault: vi.fn() };
}

function attach(
  embedder: MockWebContents,
  guest: MockWebContents,
  preferences: WebPreferences = {},
) {
  const attachEvent = event();
  embedder.emit('will-attach-webview', attachEvent, preferences, params());
  expect(attachEvent.preventDefault).not.toHaveBeenCalled();
  embedder.emit('did-attach-webview', {}, guest as unknown as WebContents);
}

describe('local HTML preview guest policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts only the dedicated chrome-free attachment identity', () => {
    expect(isExpectedWebBrowserAttachment(params())).toBe(true);
    expect(isExpectedWebBrowserAttachment(params({ allowpopups: true }))).toBe(false);
    expect(isExpectedWebBrowserAttachment(params({ partition: 'persist:other' }))).toBe(false);
    expect(isExpectedWebBrowserAttachment(params({ src: 'file:///workspace/site.html' }))).toBe(false);
    expect(isExpectedWebBrowserAttachment(params({ preload: '/tmp/preload.js' }))).toBe(false);
  });

  it('forces every security-sensitive guest preference', () => {
    const preferences: WebPreferences = {
      preload: '/tmp/preload.js',
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

  it('registers one live guest and releases it on destruction', () => {
    const registry = new WebBrowserGuestRegistry();
    const guest = new MockWebContents('webview', {} as Session);

    expect(registry.beginAttachment()).toBe(true);
    expect(registry.beginAttachment()).toBe(false);
    registry.completeAttachment(guest as unknown as WebContents);
    expect(registry.current()).toBe(guest);
    expect(registry.beginAttachment()).toBe(false);

    guest.destroy();
    expect(registry.current()).toBeNull();
    expect(registry.beginAttachment()).toBe(true);
  });

  it('blocks links, redirects, script navigation, in-page navigation, and popups', async () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const guest = new MockWebContents('webview', browserSession);
    const registry = new WebBrowserGuestRegistry();
    const cleanup = installWebBrowserGuestPolicy(embedder as unknown as WebContents, {
      browserSession,
      registry,
    });
    attach(embedder, guest);

    for (const [type, url] of [
      ['will-frame-navigate', 'file:///workspace/other.html'],
      ['will-frame-navigate', 'https://example.com/'],
      ['will-redirect', 'file:///workspace/redirect.html'],
    ]) {
      const navigationEvent = event();
      guest.emit(type, { ...navigationEvent, url });
      expect(navigationEvent.preventDefault).toHaveBeenCalledOnce();
    }

    expect(guest.windowOpenHandler?.({ url: 'https://example.com/' } as never)).toEqual({ action: 'deny' });
    guest.emit('did-finish-load');
    expect(guest.insertCSS).toHaveBeenCalledWith(
      expect.stringContaining('pointer-events: none !important'),
      { cssOrigin: 'user' },
    );

    guest.emit('did-start-navigation', {
      isMainFrame: true,
      url: 'https://example.com/script',
    });
    expect(guest.stop).toHaveBeenCalledOnce();

    guest.emit('did-navigate', {}, 'file:///workspace/site.html');
    guest.emit('did-navigate-in-page', {}, 'file:///workspace/site.html#section', true);
    await Promise.resolve();
    expect(guest.loadURL).toHaveBeenCalledWith('file:///workspace/site.html');

    cleanup();
  });

  it('rejects additional or mismatched guests', () => {
    const browserSession = {} as Session;
    const embedder = new MockWebContents('window', {} as Session);
    const registry = new WebBrowserGuestRegistry();
    installWebBrowserGuestPolicy(embedder as unknown as WebContents, { browserSession, registry });

    const invalid = event();
    embedder.emit('will-attach-webview', invalid, {}, params({ partition: 'persist:other' }));
    expect(invalid.preventDefault).toHaveBeenCalledOnce();

    const first = new MockWebContents('webview', browserSession);
    attach(embedder, first);
    const duplicate = event();
    embedder.emit('will-attach-webview', duplicate, {}, params());
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
  });
});

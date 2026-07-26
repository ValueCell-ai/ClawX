import { EventEmitter } from 'node:events';
import type {
  BrowserWindow,
  DownloadItem,
  MessageBoxOptions,
  MessageBoxReturnValue,
  Session,
  WebContents,
} from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBrowserGuestRegistry } from '@electron/main/web-browser-policy';
import { configureWebBrowserSession } from '@electron/main/web-browser-session';
import {
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';

const mocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  showMessageBox: vi.fn(),
  getSetting: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showMessageBox: (...args: unknown[]) => mocks.showMessageBox(...args),
  },
  session: { fromPartition: mocks.fromPartition },
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: mocks.getSetting,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { warn: mocks.warn },
}));

type PermissionCheckHandler = NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
type PermissionRequestHandler = NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
type WillDownloadHandler = Parameters<Session['on']>[1];

interface SessionHarness {
  session: Session;
  setUserAgent: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setProxy: ReturnType<typeof vi.fn>;
  closeAllConnections: ReturnType<typeof vi.fn>;
  listeners: Map<string, (...args: never[]) => void>;
  checkHandler: () => PermissionCheckHandler;
  requestHandler: () => PermissionRequestHandler;
}

class MockGuest extends EventEmitter {
  destroyed = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

class MockDownloadItem extends EventEmitter {
  readonly setSavePath = vi.fn();
}

function createSessionHarness(): SessionHarness {
  let checkHandler: PermissionCheckHandler | null = null;
  let requestHandler: PermissionRequestHandler | null = null;
  const listeners = new Map<string, (...args: never[]) => void>();
  const setUserAgent = vi.fn();
  const setPermissionCheckHandler = vi.fn((handler: PermissionCheckHandler | null) => {
    checkHandler = handler;
  });
  const setPermissionRequestHandler = vi.fn((handler: PermissionRequestHandler | null) => {
    requestHandler = handler;
  });
  const setProxy = vi.fn();
  const closeAllConnections = vi.fn();
  const on = vi.fn((event: string, listener: (...args: never[]) => void) => {
    listeners.set(event, listener);
  });
  const browserSession = {
    setUserAgent,
    setPermissionCheckHandler,
    setPermissionRequestHandler,
    on,
    setProxy,
    closeAllConnections,
  } as unknown as Session;

  return {
    session: browserSession,
    setUserAgent,
    setPermissionCheckHandler,
    setPermissionRequestHandler,
    on,
    setProxy,
    closeAllConnections,
    listeners,
    checkHandler: () => {
      if (!checkHandler) throw new Error('Permission check handler was not installed');
      return checkHandler;
    },
    requestHandler: () => {
      if (!requestHandler) throw new Error('Permission request handler was not installed');
      return requestHandler;
    },
  };
}

function registerGuest(registry: WebBrowserGuestRegistry): MockGuest {
  const guest = new MockGuest();
  expect(registry.beginAttachment()).toBe(true);
  registry.completeAttachment(guest as unknown as WebContents);
  return guest;
}

function requestDetails(overrides: Record<string, unknown> = {}) {
  return {
    isMainFrame: true,
    requestingUrl: 'https://fallback.example/page',
    ...overrides,
  } as Electron.PermissionRequest;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('web browser session policy', () => {
  let harness: SessionHarness;
  let registry: WebBrowserGuestRegistry;
  let mainWindow: BrowserWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createSessionHarness();
    registry = new WebBrowserGuestRegistry();
    mainWindow = {} as BrowserWindow;
    mocks.fromPartition.mockReturnValue(harness.session);
    mocks.getSetting.mockResolvedValue('en');
    mocks.showMessageBox.mockResolvedValue({ response: 1 });
  });

  function configure(overrides: Partial<Parameters<typeof configureWebBrowserSession>[0]> = {}) {
    return configureWebBrowserSession({
      registry,
      getMainWindow: () => mainWindow,
      ...overrides,
    });
  }

  it('configures the exact persistent partition, UA, handlers, and one download listener', () => {
    expect(configure()).toBe(harness.session);

    expect(mocks.fromPartition).toHaveBeenCalledOnce();
    expect(mocks.fromPartition).toHaveBeenCalledWith(WEB_BROWSER_PARTITION, { cache: true });
    expect(harness.setUserAgent).toHaveBeenCalledOnce();
    expect(harness.setUserAgent).toHaveBeenCalledWith(WEB_BROWSER_USER_AGENT);
    expect(harness.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(harness.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(harness.listeners.size).toBe(1);
    expect(harness.listeners.has('will-download')).toBe(true);
    expect(harness.setProxy).not.toHaveBeenCalled();
    expect(harness.closeAllConnections).not.toHaveBeenCalled();
  });

  it('does not duplicate the download observer when the persistent Session is configured again', () => {
    configure();
    configure();

    expect(harness.on).toHaveBeenCalledOnce();
    expect(harness.on).toHaveBeenCalledWith('will-download', expect.any(Function));
  });

  it('allows only clipboard variants during synchronous permission checks', () => {
    configure();
    const check = harness.checkHandler();
    const allowed = [
      'clipboard-read',
      'clipboard-sanitized-write',
      'deprecated-sync-clipboard-read',
    ] as const;

    for (const permission of allowed) {
      expect(check(null, permission, 'https://example.com', {} as never)).toBe(true);
    }
    for (const permission of ['media', 'geolocation', 'notifications', 'fileSystem'] as const) {
      expect(check(null, permission, 'https://example.com', {} as never)).toBe(false);
    }
  });

  it('grants clipboard requests immediately without opening a dialog', () => {
    configure();
    const request = harness.requestHandler();

    for (const permission of [
      'clipboard-read',
      'clipboard-sanitized-write',
      'deprecated-sync-clipboard-read',
    ]) {
      const callback = vi.fn();
      request({} as WebContents, permission as never, callback, requestDetails());
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(true);
    }
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it('prompts once for combined camera and microphone with current locale and origin', async () => {
    const guest = registerGuest(registry);
    const showMessageBox = vi.fn<(
      window: BrowserWindow,
      options: MessageBoxOptions,
    ) => Promise<MessageBoxReturnValue>>().mockResolvedValue({ response: 0 } as MessageBoxReturnValue);
    const getLanguage = vi.fn().mockResolvedValue('zh-CN');
    configure({ showMessageBox, getLanguage });
    const callback = vi.fn();

    harness.requestHandler()(
      guest as unknown as WebContents,
      'media',
      callback,
      requestDetails({
        mediaTypes: ['video', 'audio'],
        securityOrigin: 'https://camera.example',
      }),
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

    expect(getLanguage).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledWith(mainWindow, expect.objectContaining({
      buttons: ['允许', '拒绝'],
      cancelId: 1,
      defaultId: 0,
      message: expect.stringContaining('https://camera.example'),
    }));
    expect(showMessageBox.mock.calls[0][1].message).toContain('摄像头和麦克风');
    expect(callback).toHaveBeenCalledWith(true);
  });

  it('maps denial, prompts again, and resolves language at request time', async () => {
    const guest = registerGuest(registry);
    const getLanguage = vi.fn()
      .mockResolvedValueOnce('ja')
      .mockResolvedValueOnce('ru');
    const showMessageBox = vi.fn()
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 0 });
    configure({ getLanguage, showMessageBox });

    const first = vi.fn();
    harness.requestHandler()(
      guest as unknown as WebContents,
      'media',
      first,
      requestDetails({ mediaTypes: ['video'], securityOrigin: 'https://repeat.example' }),
    );
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith(false));

    const second = vi.fn();
    harness.requestHandler()(
      guest as unknown as WebContents,
      'media',
      second,
      requestDetails({ mediaTypes: ['audio'], securityOrigin: 'https://repeat.example' }),
    );
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith(true));

    expect(getLanguage).toHaveBeenCalledTimes(2);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[0][1].buttons).toEqual(['許可', '拒否']);
    expect(showMessageBox.mock.calls[1][1].buttons).toEqual(['Разрешить', 'Запретить']);
  });

  it('denies a media request if its guest is destroyed or replaced while the dialog is open', async () => {
    const guest = registerGuest(registry);
    const dialogResult = deferred<MessageBoxReturnValue>();
    configure({ showMessageBox: () => dialogResult.promise });
    const callback = vi.fn();

    harness.requestHandler()(
      guest as unknown as WebContents,
      'media',
      callback,
      requestDetails({ mediaTypes: ['video'] }),
    );
    await vi.waitFor(() => expect(mocks.getSetting).toHaveBeenCalledOnce());
    guest.destroy();
    registerGuest(registry);
    dialogResult.resolve({ response: 0 } as MessageBoxReturnValue);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

    expect(callback).toHaveBeenCalledWith(false);
  });

  it('denies unowned, empty-media, geolocation, display capture, and other requests without dialogs', () => {
    configure();
    const request = harness.requestHandler();
    const registeredGuest = registerGuest(registry);
    const unrelatedGuest = new MockGuest();
    const cases: Array<[WebContents, string, Electron.PermissionRequest]> = [
      [unrelatedGuest as unknown as WebContents, 'media', requestDetails({ mediaTypes: ['video'] })],
      [registeredGuest as unknown as WebContents, 'media', requestDetails({ mediaTypes: [] })],
      [registeredGuest as unknown as WebContents, 'media', requestDetails({ mediaTypes: ['screen'] })],
      [registeredGuest as unknown as WebContents, 'geolocation', requestDetails()],
      [registeredGuest as unknown as WebContents, 'display-capture', requestDetails()],
      [registeredGuest as unknown as WebContents, 'notifications', requestDetails()],
    ];

    for (const [contents, permission, details] of cases) {
      const callback = vi.fn();
      request(contents, permission as never, callback, details);
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(false);
    }
    expect(mocks.showMessageBox).not.toHaveBeenCalled();
  });

  it('calls media callbacks exactly once when no window exists or dialog work fails', async () => {
    const guest = registerGuest(registry);
    const failures = [
      { getMainWindow: () => null },
      { getLanguage: vi.fn().mockRejectedValue(new Error('language failed')) },
      { showMessageBox: vi.fn().mockRejectedValue(new Error('dialog failed')) },
    ];

    for (const failure of failures) {
      harness = createSessionHarness();
      mocks.fromPartition.mockReturnValue(harness.session);
      configure(failure);
      const callback = vi.fn();
      harness.requestHandler()(
        guest as unknown as WebContents,
        'media',
        callback,
        requestDetails({ mediaTypes: ['audio'] }),
      );
      await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
      expect(callback).toHaveBeenCalledWith(false);
    }
  });

  it('looks up the default dialog implementation when each request is handled', async () => {
    const guest = registerGuest(registry);
    configure();
    const replacement = vi.fn().mockResolvedValue({ response: 0 });
    mocks.showMessageBox.mockImplementation(replacement);
    const callback = vi.fn();

    harness.requestHandler()(
      guest as unknown as WebContents,
      'media',
      callback,
      requestDetails({ mediaTypes: ['video'] }),
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(true));
    expect(replacement).toHaveBeenCalledOnce();
  });

  it('keeps Electron default downloads and logs only terminal interruption', async () => {
    configure();
    const listener = harness.listeners.get('will-download') as WillDownloadHandler;
    const observeDownload = (state: 'completed' | 'cancelled' | 'interrupted') => {
      const event = { preventDefault: vi.fn() };
      const item = new MockDownloadItem();
      listener(event as never, item as unknown as DownloadItem, {} as WebContents);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(item.setSavePath).not.toHaveBeenCalled();
      item.emit('done', {}, state);
    };

    observeDownload('completed');
    observeDownload('cancelled');
    expect(mocks.warn).not.toHaveBeenCalled();
    observeDownload('interrupted');
    await flushPromises();
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('interrupted'));
  });
});

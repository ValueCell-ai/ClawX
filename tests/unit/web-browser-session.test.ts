import type { BrowserWindow, Session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebBrowserGuestRegistry } from '@electron/main/web-browser-policy';
import { configureWebBrowserSession } from '@electron/main/web-browser-session';
import { WEB_BROWSER_PARTITION, WEB_BROWSER_USER_AGENT } from '@shared/web-browser';

const fromPartition = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  session: { fromPartition },
}));

interface Harness {
  session: Session;
  setUserAgent: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setDevicePermissionHandler: ReturnType<typeof vi.fn>;
  setDisplayMediaRequestHandler: ReturnType<typeof vi.fn>;
  onBeforeRequest: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const setUserAgent = vi.fn();
  const setPermissionCheckHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const setDevicePermissionHandler = vi.fn();
  const setDisplayMediaRequestHandler = vi.fn();
  const onBeforeRequest = vi.fn();
  const on = vi.fn();
  return {
    session: {
      setUserAgent,
      setPermissionCheckHandler,
      setPermissionRequestHandler,
      setDevicePermissionHandler,
      setDisplayMediaRequestHandler,
      webRequest: { onBeforeRequest },
      on,
    } as unknown as Session,
    setUserAgent,
    setPermissionCheckHandler,
    setPermissionRequestHandler,
    setDevicePermissionHandler,
    setDisplayMediaRequestHandler,
    onBeforeRequest,
    on,
  };
}

describe('local HTML preview session policy', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = createHarness();
    fromPartition.mockReturnValue(harness.session);
  });

  function configure() {
    return configureWebBrowserSession({
      registry: new WebBrowserGuestRegistry(),
      getMainWindow: () => null as BrowserWindow | null,
    });
  }

  it('uses the isolated partition and denies every permission', () => {
    expect(configure()).toBe(harness.session);

    expect(fromPartition).toHaveBeenCalledWith(WEB_BROWSER_PARTITION, { cache: true });
    expect(harness.setUserAgent).toHaveBeenCalledWith(WEB_BROWSER_USER_AGENT);
    expect(harness.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(harness.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(harness.setDevicePermissionHandler).toHaveBeenCalledOnce();
    expect(harness.setDisplayMediaRequestHandler).toHaveBeenCalledOnce();

    const check = harness.setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean;
    expect(check()).toBe(false);

    const permissionCallback = vi.fn();
    const request = harness.setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: unknown,
      callback: (allowed: boolean) => void,
    ) => void;
    request(null, 'clipboard-read', permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);
  });

  it('blocks network requests and non-HTML main documents', () => {
    configure();
    const handler = harness.onBeforeRequest.mock.calls[0]?.[1] as (
      details: { url: string; resourceType: string },
      callback: (result: { cancel: boolean }) => void,
    ) => void;

    for (const [url, resourceType, cancel] of [
      ['file:///workspace/site.html', 'mainFrame', false],
      ['file:///workspace/style.css', 'stylesheet', false],
      ['file:///workspace/readme.txt', 'mainFrame', true],
      ['https://example.com/script.js', 'script', true],
      ['wss://example.com/socket', 'webSocket', true],
    ] as const) {
      const callback = vi.fn();
      handler({ url, resourceType }, callback);
      expect(callback).toHaveBeenCalledWith({ cancel });
    }
  });

  it('cancels downloads and installs the observer once per Session', () => {
    configure();
    configure();

    expect(harness.on).toHaveBeenCalledTimes(1);
    expect(harness.on).toHaveBeenCalledWith('will-download', expect.any(Function));
    const handler = harness.on.mock.calls[0]?.[1] as (event: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
